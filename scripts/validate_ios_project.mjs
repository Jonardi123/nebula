import { existsSync, readFileSync, statSync } from "node:fs";

const required = [
  "capacitor.config.ts",
  "ios/App/App.xcodeproj/project.pbxproj",
  "ios/App/App/Info.plist",
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  "ios/App/CapApp-SPM/Package.swift",
  "native/secure-storage/Package.swift",
  "codemagic.yaml",
];

const failures = [];
for (const file of required) {
  if (!existsSync(file)) failures.push(`Missing ${file}`);
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const project = read("ios/App/App.xcodeproj/project.pbxproj");
const info = read("ios/App/App/Info.plist");
const packages = read("ios/App/CapApp-SPM/Package.swift");
const config = read("capacitor.config.ts");

if (!project.includes("PRODUCT_BUNDLE_IDENTIFIER = com.jonard.nebula;")) {
  failures.push("iOS bundle identifier is not com.jonard.nebula");
}
if (!project.includes("IPHONEOS_DEPLOYMENT_TARGET = 16.0;")) {
  failures.push("iOS deployment target is not 16.0");
}
if (!/appId:\s*['"]com\.jonard\.nebula['"]/.test(config)) {
  failures.push("Capacitor app ID does not match the Xcode project");
}
if (!/contentInset:\s*['"]never['"]/.test(config)) {
  failures.push("The iOS WebView must be edge-to-edge (contentInset: never)");
}
for (const key of [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSSpeechRecognitionUsageDescription",
]) {
  if (!info.includes(`<key>${key}</key>`)) failures.push(`Info.plist is missing ${key}`);
}
if (!packages.includes("NebulaSecureStorage")) {
  failures.push("The native Keychain plugin is not registered");
}
const icon = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
if (existsSync(icon) && statSync(icon).size < 10_000) {
  failures.push("The iOS icon looks like a placeholder");
}

if (failures.length) {
  console.error("Nebula iOS validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Nebula iOS project is ready for a macOS build.");
