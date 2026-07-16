import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { listFiles, pickProjectFolder, readFile, type FileNode } from '../lib/fileSystem';
import { ensureBackgroundSummaries, recordFileReference } from '../lib/fileInsights';
import { warmModelInBackground } from '../lib/modelManager';
import { notify } from '../lib/notifications';
import { detectProjectProfile } from '../lib/projectProfiles';
import { createLog } from '../lib/logger';
import type { LogEvent } from '../types/agent';
import type { WorkspaceAwarenessSnapshot } from '../types/nebula';
import type { AppSettings } from '../types/settings';

type UseProjectFilesArgs = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  workspaceAwareness: WorkspaceAwarenessSnapshot | null;
  addLog: (log: LogEvent) => void;
};

export function useProjectFiles({ settings, setSettings, workspaceAwareness, addLog }: UseProjectFilesArgs) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [openedFile, setOpenedFile] = useState<{ path: string; content: string } | null>(null);

  useEffect(() => {
    if (!settings.projectFolder) return;
    listFiles(settings.projectFolder)
      .then((next) => {
        setFiles(next);
        window.setTimeout(() => ensureBackgroundSummaries(next, workspaceAwareness), 800);
      })
      .catch((error) => addLog(createLog('error', `File tree failed: ${String(error)}`)));
    if (settings.backgroundPreloadCodeModel && settings.autoLoadModels) {
      warmModelInBackground(settings, 'code', 'Project folder selected.');
    }
  }, [settings.projectFolder]);

  async function chooseProject() {
    const folder = await pickProjectFolder();
    if (!folder) return;
    const baseSettings = { ...settings, projectFolder: folder };
    try {
      const profile = await detectProjectProfile(folder, baseSettings);
      setSettings((current) => ({ ...current, projectFolder: folder, activeProjectProfileId: profile.id }));
      addLog(createLog('status', `Project folder selected: ${folder}`));
      addLog(createLog('status', `Project profile active: ${profile.name} (${profile.detectedFramework})`));
      await notify({
        type: 'info',
        title: 'Project profile ready',
        message: `${profile.name} detected as ${profile.detectedFramework}.`,
        data: profile,
      });
    } catch (error) {
      setSettings((current) => ({ ...current, projectFolder: folder }));
      addLog(createLog('error', `Project profile detection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  async function openFile(path: string) {
    const content = await readFile(path);
    setOpenedFile({ path, content });
    recordFileReference(path);
    addLog(createLog('tool_result', `Read file: ${path}`));
  }

  return { files, setFiles, openedFile, setOpenedFile, chooseProject, openFile };
}
