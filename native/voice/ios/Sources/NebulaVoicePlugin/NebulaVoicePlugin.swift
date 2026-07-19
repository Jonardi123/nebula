import AVFoundation
import Capacitor
import Foundation
import Speech
import UIKit

@objc(NebulaVoicePlugin)
public class NebulaVoicePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "NebulaVoicePlugin"
    public let jsName = "NebulaVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?
    private var inputTapInstalled = false

    public override func load() {
        synthesizer.delegate = self
    }

    private func speechAuthorizationName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "prompt"
        @unknown default: return "unknown"
        }
    }

    private func microphoneAuthorizationName() -> String {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "prompt"
        @unknown default: return "unknown"
        }
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? Locale.current.identifier
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        call.resolve([
            "microphone": microphoneAuthorizationName(),
            "speech": speechAuthorizationName(SFSpeechRecognizer.authorizationStatus()),
            "available": recognizer?.isAvailable ?? false,
            "supportsOnDevice": recognizer?.supportsOnDeviceRecognition ?? false,
            "locale": locale
        ])
    }

    @objc public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            AVAudioSession.sharedInstance().requestRecordPermission { microphoneGranted in
                DispatchQueue.main.async {
                    call.resolve([
                        "microphone": microphoneGranted ? "granted" : "denied",
                        "speech": self.speechAuthorizationName(speechStatus)
                    ])
                }
            }
        }
    }

    @objc public func startListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cancelRecognition()
            let locale = call.getString("locale") ?? Locale.current.identifier
            let preferOnDevice = call.getBool("preferOnDevice") ?? true
            let allowOnline = call.getBool("allowOnline") ?? false

            guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
                call.reject("Speech recognition permission is required.", "SPEECH_PERMISSION_DENIED")
                return
            }
            guard AVAudioSession.sharedInstance().recordPermission == .granted else {
                call.reject("Microphone permission is required.", "MICROPHONE_DENIED")
                return
            }
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
                call.reject("Speech recognition is unavailable for this language.", "UNAVAILABLE_SERVICE")
                return
            }

            let useOnDevice = preferOnDevice && recognizer.supportsOnDeviceRecognition
            if preferOnDevice && !useOnDevice && !allowOnline {
                call.reject("This language requires Apple's online speech service.", "ONLINE_CONSENT_REQUIRED")
                return
            }

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = useOnDevice
            self.speechRecognizer = recognizer
            self.recognitionRequest = request

            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .measurement, options: [.duckOthers, .allowBluetooth])
                try session.setActive(true, options: .notifyOthersOnDeactivation)
                let input = self.audioEngine.inputNode
                let format = input.outputFormat(forBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    request.append(buffer)
                }
                self.inputTapInstalled = true
                self.audioEngine.prepare()
                try self.audioEngine.start()
            } catch {
                self.cancelRecognition()
                call.reject("The microphone could not start: \(error.localizedDescription)", "AUDIO_CAPTURE_FAILURE")
                return
            }

            self.notifyListeners("voiceState", data: ["phase": "listening", "engine": useOnDevice ? "apple_local" : "apple_online"])
            self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let result {
                        self.notifyListeners("voiceResult", data: [
                            "text": result.bestTranscription.formattedString,
                            "isFinal": result.isFinal
                        ])
                        if result.isFinal {
                            self.finishRecognition()
                            return
                        }
                    }
                    if let error {
                        let nsError = error as NSError
                        self.notifyListeners("voiceError", data: [
                            "code": nsError.code == 216 ? "cancelled" : "unavailable_service",
                            "message": error.localizedDescription
                        ])
                        self.cancelRecognition()
                    }
                }
            }
            call.resolve(["engine": useOnDevice ? "apple_local" : "apple_online", "supportsOnDevice": recognizer.supportsOnDeviceRecognition])
        }
    }

    @objc public func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.recognitionRequest?.endAudio()
            if self.audioEngine.isRunning { self.audioEngine.stop() }
            self.removeInputTap()
            call.resolve()
        }
    }

    @objc public func cancelListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cancelRecognition()
            call.resolve()
        }
    }

    private func finishRecognition() {
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        recognitionRequest?.endAudio()
        recognitionTask = nil
        recognitionRequest = nil
        speechRecognizer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notifyListeners("voiceState", data: ["phase": "idle"])
    }

    private func cancelRecognition() {
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        speechRecognizer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func removeInputTap() {
        guard inputTapInstalled else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        inputTapInstalled = false
    }

    @objc public func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("Text is required.", "EMPTY_TEXT")
            return
        }
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: call.getString("locale") ?? Locale.current.identifier)
            let rate = Float(call.getDouble("rate") ?? 1.0)
            let pitch = Float(call.getDouble("pitch") ?? 1.0)
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * rate))
            utterance.pitchMultiplier = min(2.0, max(0.5, pitch))
            self.synthesizer.speak(utterance)
            call.resolve()
        }
    }

    @objc public func stopSpeaking(_ call: CAPPluginCall) {
        synthesizer.stopSpeaking(at: .immediate)
        call.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        notifyListeners("voiceState", data: ["phase": "speaking"])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        notifyListeners("voiceState", data: ["phase": "idle"])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        notifyListeners("voiceState", data: ["phase": "idle"])
    }

    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString), UIApplication.shared.canOpenURL(url) else {
                call.reject("iOS settings could not be opened.")
                return
            }
            UIApplication.shared.open(url)
            call.resolve()
        }
    }
}
