import { App, Notice, Modal } from 'obsidian';
import type { LLMProviderConfig } from '../types/settings.types';
import type { LuminaSettings } from '../../core/settings/settings.types';
import { createProvider } from '../../core/llm-providers/index';
import en from './en.json';
import { ConfirmModal } from '../utils/modal';
import { addDynamicLocale, setLanguage, t } from './helpers';

/**
 * Initializes the translation flow. Prompts the user for confirmation and then translates.
 */
export async function translatePluginLocales(app: App, settings: LuminaSettings): Promise<void> {
    let providerConfig: LLMProviderConfig | undefined;
    let modelName = '';

    if (settings.connections.defaultProviderId && settings.connections.defaultModelId) {
        providerConfig = settings.connections.providers.find((p: LLMProviderConfig) => p.id === settings.connections.defaultProviderId);
        modelName = settings.connections.defaultModelId;
    }

    if (!providerConfig) {
        providerConfig = settings.connections.providers.find((p: LLMProviderConfig) => p.isVerified && p.availableModels.length > 0);
        modelName = providerConfig?.availableModels[0] || '';
    }

    if (!providerConfig || !modelName) {
        new Notice(t('settings.translation.noValidModel'));
        return;
    }

    const providerAlias = providerConfig.type;

    return new Promise((resolve) => {
        const modal = new ConfirmModal(
            app,
            t('settings.translation.confirmTitle'),
            t('settings.translation.confirmMsg', { provider: providerAlias, model: modelName }),
            async () => {
                const progressModal = new Modal(app);
                progressModal.titleEl.setText(t('settings.translation.progressTitle'));
                progressModal.contentEl.createEl('div', {
                    text: t('settings.translation.progressMsg')
                });
                const isLocal = ['ollama', 'lmstudio', 'custom'].includes(providerConfig.type);
                const delayMsg = isLocal
                    ? t('settings.translation.delayLocal')
                    : t('settings.translation.delayCloud');

                progressModal.contentEl.createEl('div', {
                    text: delayMsg,
                    cls: 'setting-item-description',
                    attr: { style: 'margin-top: 10px;' }
                });
                progressModal.open();

                try {
                    await executeTranslation(app, providerConfig!, modelName);
                } catch (e) {
                    new Notice(`${t('settings.translation.fail')}${(e as Error).message}`);
                } finally {
                    progressModal.close();
                    resolve();
                }
            }
        );
        modal.open();
    });
}

/**
 * Executes the LLM translation and saves the JSON to cache.
 */
async function executeTranslation(app: App, providerConfig: LLMProviderConfig, model: string) {
    const provider = createProvider(providerConfig);
    const systemLocale = window.navigator.language;

    const sourceJson = JSON.stringify(en, null, 2);
    const prompt = `You are an expert software localization translator. Translate the following JSON object's values into the language: "${systemLocale}".
Maintain the exact JSON keys, structure, and formatting (including any placeholders like {{var}}).
Strictly output ONLY the raw valid JSON object. Do not include any conversational text, markdown code blocks (\` \` \`), or explanations.

Source JSON:
${sourceJson}
`;

    const response = await provider.chat([{ role: 'user', content: prompt }], {
        model,
        temperature: 0.1, // Low temp for more deterministic translation
    });

    // Parse response
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.substring(7);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.substring(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }

    let translatedData;
    try {
        translatedData = JSON.parse(jsonStr);
    } catch (e) {
        console.error("Translation JSON Parse Error:", e);
        console.log("Raw Response:", response);
        throw new Error("LLM이 올바른 JSON 형식을 반환하지 않았습니다.");
    }

    // Save to cache
    const configDir = app.vault.configDir;
    const cacheDir = `${configDir}/plugins/lumina/locales`;

    const exists = await app.vault.adapter.exists(cacheDir);
    if (!exists) {
        await app.vault.adapter.mkdir(cacheDir);
    }

    const cacheFile = `${cacheDir}/system.json`;
    await app.vault.adapter.write(cacheFile, JSON.stringify(translatedData, null, 2));

    // Load into memory
    addDynamicLocale('system', translatedData);
    await setLanguage('system');

    new Notice(t('settings.translation.success'));
}

/**
 * Loads the cached translation from disk into memory.
 */
export async function loadSystemLocaleCache(app: App): Promise<boolean> {
    const configDir = app.vault.configDir;
    const cacheFile = `${configDir}/plugins/lumina/locales/system.json`;

    if (await app.vault.adapter.exists(cacheFile)) {
        try {
            const data = await app.vault.adapter.read(cacheFile);
            const json = JSON.parse(data);
            addDynamicLocale('system', json);
            return true;
        } catch (e) {
            console.error('Failed to load locale cache', e);
            return false;
        }
    }
    return false;
}

/**
 * Deletes the cached translation from disk.
 */
export async function deleteSystemLocaleCache(app: App): Promise<boolean> {
    const configDir = app.vault.configDir;
    const cacheFile = `${configDir}/plugins/lumina/locales/system.json`;

    if (await app.vault.adapter.exists(cacheFile)) {
        try {
            await app.vault.adapter.remove(cacheFile);
            new Notice(t('settings.translation.cacheDeleted'));
            return true;
        } catch (e) {
            console.error('Failed to delete locale cache', e);
            new Notice(`${t('settings.translation.cacheDeleteFail')}${(e as Error).message}`);
            return false;
        }
    }
    new Notice(t('settings.translation.noCache'));
    return false;
}