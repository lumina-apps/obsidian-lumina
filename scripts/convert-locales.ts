/**
 * TS 로캘 파일을 JSON으로 변환하는 스크립트
 * 사용법: npx tsx scripts/convert-locales.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'shared', 'locales');

interface LocaleEntry {
    filename: string;
    varName: string;
}

const LOCALE_ENTRIES: LocaleEntry[] = [
    { filename: 'en', varName: 'en' },
    { filename: 'ko', varName: 'ko' },
    { filename: 'ja', varName: 'ja' },
    { filename: 'zh', varName: 'zh' },
    { filename: 'zh-tw', varName: 'zhTW' },
    { filename: 'es', varName: 'es' },
    { filename: 'pt', varName: 'pt' },
    { filename: 'de', varName: 'de' },
    { filename: 'fr', varName: 'fr' },
    { filename: 'ru', varName: 'ru' },
    { filename: 'it', varName: 'it' },
];

function convertTsToJson(entry: LocaleEntry): void {
    const tsPath = path.join(LOCALES_DIR, `${entry.filename}.ts`);
    const jsonPath = path.join(LOCALES_DIR, `${entry.filename}.json`);

    if (!fs.existsSync(tsPath)) {
        console.warn(`⚠️  ${tsPath} not found, skipping.`);
        return;
    }

    const content = fs.readFileSync(tsPath, 'utf-8');

    // 1. import 문 제거
    let js = content
        .replace(/^import\s+.*?;\s*$/gm, '')
        .replace(/^export\s+type\s+.*$/gm, ''); // type export만 제거

    // 2. export const varName: TypeAnnotation = → varName =
    js = js.replace(
        /export\s+const\s+(\w+)\s*:\s*\w+(<[^>]*>)?\s*=\s*/,
        '$1 = '
    );

    // 3. trailing semicolons 제거
    js = js.replace(/;\s*$/, '').trim();

    // 4. new Function으로 JS 객체로 평가
    const sandbox: Record<string, unknown> = {};
    // 변수를 글로벌이 아닌 sandbox에 바인딩하기 위한 트릭
    const keys: string[] = [];
    const values: unknown[] = [];

    // 패턴: varName = { ... }
    const match = js.match(/^(\w+)\s*=\s*/);
    if (!match) {
        console.error(`❌ Could not parse export in ${entry.filename}.ts`);
        return;
    }

    const varName = match[1];
    const body = js.substring(match[0].length); // 객체 리터럴 부분

    // 객체 리터럴을 평가
    try {
        const obj = new Function(`return (${body})`)();
        const json = JSON.stringify(obj, null, 2);
        fs.writeFileSync(jsonPath, json + '\n', 'utf-8');
        console.log(`✅ Converted ${entry.filename}.ts → ${entry.filename}.json`);
    } catch (e) {
        console.error(`❌ Failed to parse ${entry.filename}.ts:`, (e as Error).message);
    }
}

// 메인 실행
console.log('🔄 Converting TS locale files to JSON...\n');

for (const entry of LOCALE_ENTRIES) {
    convertTsToJson(entry);
}

console.log('\n🎉 All locale files converted to JSON!');