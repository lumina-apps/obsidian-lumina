const fs = require('fs');

const tsPath = 'src/core/mcp/server/toolDefinitions.ts';
let tsContent = fs.readFileSync(tsPath, 'utf8');

const toolsToTranslate = [
    'replace_note', 'patch_note', 'delete_note', 'move_note', 'get_backlinks',
    'update_frontmatter', 'get_note_metadata', 'list_attachments', 'save_attachment',
    'execute_code', 'run_shell_command', 'run_note_code_block', 'list_tags',
    'create_canvas', 'generate_moc', 'auto_link_note', 'query_metadata'
];

let enJson = JSON.parse(fs.readFileSync('src/shared/locales/en.json', 'utf8'));
let koJson = JSON.parse(fs.readFileSync('src/shared/locales/ko.json', 'utf8'));

if (!enJson.mcpServerTools) enJson.mcpServerTools = {};
if (!koJson.mcpServerTools) koJson.mcpServerTools = {};

for (const tool of toolsToTranslate) {
    if (!enJson.mcpServerTools[tool]) {
        enJson.mcpServerTools[tool] = { desc: "TODO" };
        koJson.mcpServerTools[tool] = { desc: "TODO" };
    }
}

const regex = /name:\s*'([^']+)',\s*description:\s*'([^']+)'/g;
tsContent = tsContent.replace(regex, (match, name, desc) => {
    if (toolsToTranslate.includes(name)) {
        enJson.mcpServerTools[name].desc = desc;
        koJson.mcpServerTools[name].desc = desc + ' (ko)'; // Just a placeholder, I will translate it properly later
        return `name: '${name}',\n\t\t\tdescription: t('mcpServerTools.${name}.desc')`;
    }
    return match;
});

fs.writeFileSync(tsPath, tsContent);
fs.writeFileSync('src/shared/locales/en.json', JSON.stringify(enJson, null, 2));
fs.writeFileSync('src/shared/locales/ko.json', JSON.stringify(koJson, null, 2));
console.log("Updated ts and json files");
