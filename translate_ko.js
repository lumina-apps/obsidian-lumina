const fs = require('fs');
let koJson = JSON.parse(fs.readFileSync('src/shared/locales/ko.json', 'utf8'));

const translations = {
    'replace_note': '기존 노트의 전체 내용을 바꿉니다.',
    'patch_note': '노트에 하나 이상의 텍스트 변경 사항을 적용합니다. 여러 변경 사항을 한 번에 일괄 처리하려면 patches 배열을 사용하는 것이 좋습니다.',
    'delete_note': '노트를 삭제합니다.',
    'move_note': '노트를 이동하거나 이름을 변경합니다.',
    'get_backlinks': '특정 노트를 링크하고 있는 노트 목록을 가져옵니다.',
    'update_frontmatter': '노트의 프론트매터(Frontmatter) 속성을 업데이트합니다.',
    'get_note_metadata': '노트의 메타데이터(프론트매터, 태그, 생성일 등)를 가져옵니다.',
    'list_attachments': '볼트 내의 모든 첨부 파일(이미지, PDF 등)을 나열하거나 특정 노트에 링크된 첨부 파일을 찾습니다.',
    'save_attachment': 'Base64 문자열에서 바이너리 첨부 파일을 저장합니다.',
    'execute_code': '보안 샌드박스에서 Javascript/Typescript 코드를 실행합니다.',
    'run_shell_command': '데스크톱 OS에서 터미널 쉘 명령을 실행합니다. 주의해서 사용하세요.',
    'run_note_code_block': '노트 내의 특정 코드 블록을 샌드박스에서 실행합니다.',
    'list_tags': '볼트에서 사용된 모든 태그를 나열합니다.',
    'create_canvas': '노드와 에지가 포함된 Obsidian Canvas 파일(.canvas)을 생성합니다.',
    'generate_moc': '관련 노트를 수집하고 연결하는 MOC(Map of Content) 노트를 생성합니다. 폴더, 태그 또는 파일을 사용하여 포함할 노트를 정의합니다.',
    'auto_link_note': '노트 내에서 연결되지 않은 멘션(노트 제목 또는 별칭)을 자동으로 찾아 내부 마크다운 링크로 바꿉니다.',
    'query_metadata': '프론트매터 속성, 태그 또는 폴더를 기준으로 볼트 노트를 필터링하고 검색합니다. 결과를 마크다운 테이블로 반환합니다.'
};

for (const [key, desc] of Object.entries(translations)) {
    if (koJson.mcpServerTools[key]) {
        koJson.mcpServerTools[key].desc = desc;
    }
}

fs.writeFileSync('src/shared/locales/ko.json', JSON.stringify(koJson, null, 2));
console.log("Translated ko.json");
