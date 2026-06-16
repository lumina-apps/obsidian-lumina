#!/usr/bin/env node

/**
 * generate-test-vault.js
 * 
 * Obsidian-Lumina 플러그인의 RAG 인덱싱/검색 성능 테스트를 위한
 * 대량의 마크다운 노트 덤프 데이터를 생성합니다.
 * 
 * 사용법:
 *   node scripts/generate-test-vault.js <출력경로> [노트수]
 * 
 * 예시:
 *   node scripts/generate-test-vault.js /Users/Username/TestVault 5000
 *   node scripts/generate-test-vault.js ./test-vault 1000
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 설정
// ============================================================
const DEFAULT_NOTE_COUNT = 3000;

// ============================================================
// 주제별 데이터
// ============================================================

const TOPICS = [
  { name: '과학/물리학', folder: 'Science/Physics' },
  { name: '과학/화학', folder: 'Science/Chemistry' },
  { name: '과학/생물학', folder: 'Science/Biology' },
  { name: '과학/천문학', folder: 'Science/Astronomy' },
  { name: '과학/지구과학', folder: 'Science/EarthScience' },
  { name: '기술/프로그래밍', folder: 'Tech/Programming' },
  { name: '기술/인공지능', folder: 'Tech/AI' },
  { name: '기술/데이터베이스', folder: 'Tech/Database' },
  { name: '기술/네트워크', folder: 'Tech/Network' },
  { name: '기술/보안', folder: 'Tech/Security' },
  { name: '역사/한국사', folder: 'History/Korea' },
  { name: '역사/세계사', folder: 'History/World' },
  { name: '역사/과학사', folder: 'History/Science' },
  { name: '철학/동양철학', folder: 'Philosophy/Eastern' },
  { name: '철학/서양철학', folder: 'Philosophy/Western' },
  { name: '철학/윤리학', folder: 'Philosophy/Ethics' },
  { name: '문학/한국문학', folder: 'Literature/Korean' },
  { name: '문학/세계문학', folder: 'Literature/World' },
  { name: '문학/시', folder: 'Literature/Poetry' },
  { name: '예술/음악', folder: 'Art/Music' },
  { name: '예술/회화', folder: 'Art/Painting' },
  { name: '예술/영화', folder: 'Art/Film' },
  { name: '경제/경제학', folder: 'Economics/Theory' },
  { name: '경제/투자', folder: 'Economics/Investment' },
  { name: '경제/비즈니스', folder: 'Economics/Business' },
  { name: '의학/해부학', folder: 'Medicine/Anatomy' },
  { name: '의학/질병', folder: 'Medicine/Diseases' },
  { name: '의학/약학', folder: 'Medicine/Pharma' },
  { name: '심리학/인지심리', folder: 'Psychology/Cognitive' },
  { name: '심리학/사회심리', folder: 'Psychology/Social' },
  { name: '심리학/발달심리', folder: 'Psychology/Developmental' },
  { name: '수학/대수학', folder: 'Math/Algebra' },
  { name: '수학/기하학', folder: 'Math/Geometry' },
  { name: '수학/통계학', folder: 'Math/Statistics' },
  { name: '언어/한국어', folder: 'Language/Korean' },
  { name: '언어/영어', folder: 'Language/English' },
  { name: '언어/일본어', folder: 'Language/Japanese' },
  { name: '지리/국내지리', folder: 'Geography/Domestic' },
  { name: '지리/세계지리', folder: 'Geography/World' },
  { name: '지리/지형학', folder: 'Geography/Geomorphology' },
  { name: '사회/정치학', folder: 'Society/Politics' },
  { name: '사회/법학', folder: 'Society/Law' },
  { name: '사회/교육학', folder: 'Society/Education' },
  { name: '환경/생태학', folder: 'Environment/Ecology' },
  { name: '환경/기후변화', folder: 'Environment/Climate' },
  { name: '환경/에너지', folder: 'Environment/Energy' },
  { name: '스포츠/구기종목', folder: 'Sports/BallGames' },
  { name: '스포츠/격투기', folder: 'Sports/MartialArts' },
  { name: '스포츠/육상', folder: 'Sports/Athletics' },
  { name: '요리/한식', folder: 'Cooking/Korean' },
  { name: '요리/양식', folder: 'Cooking/Western' },
  { name: '요리/일식', folder: 'Cooking/Japanese' },
  { name: '취미/사진', folder: 'Hobby/Photography' },
  { name: '취미/여행', folder: 'Hobby/Travel' },
  { name: '취미/게임', folder: 'Hobby/Gaming' },
  { name: '건축/건축사', folder: 'Architecture/History' },
  { name: '건축/구조', folder: 'Architecture/Structure' },
  { name: '건축/인테리어', folder: 'Architecture/Interior' },
  { name: '음악/클래식', folder: 'Music/Classical' },
  { name: '음악/재즈', folder: 'Music/Jazz' },
  { name: '음악/대중음악', folder: 'Music/Pop' },
];

// ============================================================
// 콘텐츠 생성 함수
// ============================================================

/** 지정된 길이 범위의 짧은~중간 텍스트 생성 */
function generateShortContent(topic, noteIndex) {
  const templates = [
    `# ${topic} 개요\n\n${topic}은(는) 현대 과학에서 중요한 위치를 차지하는 분야입니다. ` +
    `이 분야의 핵심 개념은 다양한 응용 분야에서 활용되고 있으며, ` +
    `지속적인 연구를 통해 새로운 발견이 이루어지고 있습니다.\n\n` +
    `## 주요 개념\n\n- 기본 원리: 자연 현상을 이해하기 위한 기초적인 틀을 제공합니다\n` +
    `- 응용: 실생활에서 다양한 형태로 적용됩니다\n` +
    `- 최신 연구 동향: 학계에서 활발히 연구 중인 주제입니다\n\n` +
    `> 관련 참고: [[${topic} 기초 개념]]`,

    `# ${topic} - 핵심 정리\n\n## 중요 포인트\n\n` +
    `1. ${topic}의 첫 번째 핵심 개념은 시스템의 기본 구조를 이해하는 것입니다.\n` +
    `2. 두 번째로 중요한 것은 이론과 실제 적용 사이의 관계입니다.\n` +
    `3. 마지막으로, 이 분야의 최신 트렌드를 파악하는 것이 중요합니다.\n\n` +
    `#tag #${topic.replace(/[/\s]/g, '')} #핵심정리`,

    `# ${topic} 노트 ${noteIndex}\n\n${topic} 분야에서 자주 논의되는 주제 중 하나는 ` +
    `초보자가 접근하기 어려운 개념들을 어떻게 효과적으로 학습할 것인가입니다.\n\n` +
    `## 학습 로드맵\n\n` +
    `1. 기초 이론 학습\n` +
    `2. 실제 사례 연구\n` +
    `3. 프로젝트 기반 학습\n` +
    `4. 커뮤니티 참여\n\n---\n\n참고 자료: [[${topic} 참고문헌]]`,

    `# ${topic} 실용 가이드\n\n` +
    `이 문서는 ${topic}에 대한 실용적인 정보를 제공합니다.\n\n` +
    `### 시작하기\n\n` +
    `이 분야를 처음 접하는 사람들을 위한 기본 가이드입니다. ` +
    `처음에는 기본 개념을 이해하는 것이 중요하며, ` +
    `점진적으로 복잡한 주제로 확장해 나가는 것이 효과적입니다.\n\n` +
    `### 고급 주제\n\n` +
    `경험이 쌓이면 다음과 같은 고급 주제를 탐구할 수 있습니다:\n` +
    `- 심화 이론\n` +
    `- 전문가 인터뷰\n` +
    `- 실제 적용 사례\n` +
    `- 연구 논문 분석`,
  ];
  return templates[noteIndex % templates.length];
}

/** 중간 길이 텍스트 (400자 이상 ~ 1000자) */
function generateMediumContent(topic, noteIndex) {
  const sections = [
    `## 역사적 배경\n\n${topic} 분야는 오랜 역사를 가지고 있습니다. ` +
    `초기 연구자들은 제한된 도구와 방법론으로도 놀라운 발견을 이루어냈습니다. ` +
    `20세기 들어 기술의 발전과 함께 이 분야는 급속도로 성장하기 시작했습니다. ` +
    `특히 컴퓨팅 기술의 발달은 ${topic} 연구에 혁명적인 변화를 가져왔습니다.\n\n` +
    `현대에 이르러서는 AI와 머신러닝 기술이 ${topic} 연구의 새로운 지평을 열고 있습니다. ` +
    `대규모 데이터 분석이 가능해지면서 이전에는 발견하지 못했던 패턴과 관계들이 밝혀지고 있습니다.`,

    `## 방법론\n\n${topic} 연구에서 사용되는 주요 방법론은 다음과 같습니다:\n\n` +
    `### 정량적 방법\n` +
    `데이터 수집과 통계 분석을 기반으로 하는 정량적 방법은 ` +
    `객관적인 결과를 도출하는 데 효과적입니다. ` +
    `실험 설계, 설문조사, 빅데이터 분석 등이 포함됩니다.\n\n` +
    `### 정성적 방법\n` +
    `정성적 방법은 깊이 있는 이해와 맥락적 분석을 제공합니다. ` +
    `사례 연구, 심층 인터뷰, 참여 관찰 등이 이에 해당합니다.\n\n` +
    `### 혼합 방법\n` +
    `최근 연구에서는 정량적 방법과 정성적 방법을 결합한 ` +
    `혼합 방법론이 많이 사용되고 있습니다.`,

    `## 주요 이론\n\n${topic} 분야를 이해하기 위한 핵심 이론들을 살펴보겠습니다.\n\n` +
    `### 이론 1: 기본 체계\n` +
    `이 이론은 ${topic}의 기본적인 구조와 원리를 설명합니다. ` +
    `모든 고급 개념은 이 기본 체계 위에 구축됩니다.\n\n` +
    `### 이론 2: 진화론적 관점\n` +
    `시간에 따른 변화와 발전을 설명하는 이론입니다. ` +
    `과거로부터 현재, 그리고 미래로 이어지는 흐름을 이해하는 데 도움을 줍니다.\n\n` +
    `### 이론 3: 시스템 접근법\n` +
    `개별 요소들의 상호작용과 전체 시스템의 emergent property를 ` +
    `이해하는 데 초점을 맞춘 접근법입니다.\n\n` +
    `이러한 이론들은 상호보완적으로 작용하여 ${topic}에 대한 ` +
    `종합적인 이해를 제공합니다.`,

    `## 실제 응용 사례\n\n${topic}이 실제 세계에서 어떻게 적용되는지 몇 가지 사례를 통해 살펴보겠습니다.\n\n` +
    `### 사례 1: 산업 현장\n` +
    `제조업, 서비스업 등 다양한 산업 분야에서 ${topic}의 원리가 적용되고 있습니다. ` +
    `공정 최적화, 품질 관리, 비용 절감 등의 효과를 얻을 수 있습니다.\n\n` +
    `### 사례 2: 일상 생활\n` +
    `우리의 일상 생활에서도 ${topic}의 개념을 쉽게 찾아볼 수 있습니다. ` +
    `의사 결정, 문제 해결, 창의적 사고 등에 활용됩니다.\n\n` +
    `### 사례 3: 첨단 기술\n` +
    `최신 기술 트렌드인 AI, IoT, 블록체인 등에서도 ` +
    `${topic}의 핵심 원리가 중요한 역할을 하고 있습니다.`,
  ];

  const body = sections[noteIndex % sections.length];
  const tags = generateTags(topic);
  const wikilinks = generateWikilinks(topic);
  
  return `# ${topic} 심화 연구 - ${noteIndex + 1}\n\n` +
    `> 이 문서는 ${topic}에 대한 심층적인 분석을 제공합니다.\n\n` +
    body + '\n\n' +
    `## 참고 자료\n\n${wikilinks}\n\n` +
    `---\n\n${tags}`;
}

/** 긴 텍스트 (1000자 이상) */
function generateLongContent(topic, noteIndex) {
  const intro = [
    `${topic} 분야는 학문적 호기심과 실용적 필요성이 만나는 지점에서 ` +
    `지속적으로 발전해왔습니다. 이 글에서는 ${topic}의 다양한 측면을 ` +
    `종합적으로 살펴보고, 현대 사회에서의 의의와 미래 전망에 대해 논의하고자 합니다.`,
    
    `${topic}은(는) 현대 지식 체계에서 중요한 축을 담당하고 있습니다. ` +
    `이 분야의 발전은 다른 학문 분야에도 지대한 영향을 미치고 있으며, ` +
    `우리의 세계관과 삶의 방식을 근본적으로 변화시키고 있습니다.`,
  ];

  const body = [
    `## 이론적 배경\n\n${topic}의 이론적 배경을 이해하기 위해서는 먼저 ` +
    `기본 개념과 역사적 발전 과정을 살펴볼 필요가 있습니다. 초기 연구자들은 ` +
    `경험적 관찰과 논리적 추론을 통해 이 분야의 기초를 다졌습니다. ` +
    `이후 과학적 방법론의 발전과 함께 더욱 체계적인 이론 체계가 구축되었습니다.\n\n` +
    `현대 ${topic} 연구는 다양한 학문 분야와의 융합을 통해 ` +
    `새로운 패러다임을 창출하고 있습니다. 예를 들어, 데이터 과학과의 결합은 ` +
    `기존에는 불가능했던 규모의 분석을 가능하게 했으며, ` +
    `이는 새로운 발견과 혁신으로 이어지고 있습니다.\n\n` +
    `### 핵심 원리\n\n` +
    `${topic}의 핵심 원리는 크게 세 가지로 요약할 수 있습니다:\n\n` +
    `1. **체계성**: 모든 현상은 상호 연결된 체계 안에서 이해되어야 합니다.\n` +
    `2. **역동성**: 고정된 상태가 아닌, 지속적으로 변화하고 발전하는 과정입니다.\n` +
    `3. **맥락 의존성**: 현상의 의미와 중요성은 그것이 위치한 맥락에 따라 달라집니다.\n\n` +
    `이러한 원리들은 ${topic}을 연구하고 적용하는 데 있어 ` +
    `중요한 가이드라인을 제공합니다.`,

    `## 현대적 적용\n\n${topic}의 현대적 적용은 매우 다양한 영역에서 이루어지고 있습니다. ` +
    `특히 주목할 만한 것은 기술의 발전과 함께 ${topic}의 적용 범위가 ` +
    `급격히 확장되고 있다는 점입니다.\n\n` +
    `### 기술 융합\n\n` +
    `인공지능, 빅데이터, 클라우드 컴퓨팅 등의 첨단 기술이 ` +
    `${topic}과 융합되면서 새로운 가치를 창출하고 있습니다. ` +
    `예를 들어, 머신러닝 알고리즘을 활용한 패턴 분석은 ` +
    `${topic} 연구의 새로운 지평을 열었습니다.\n\n` +
    `### 실용적 응용\n\n` +
    `${topic}의 원리는 다양한 산업 분야에서 실용적으로 응용되고 있습니다:\n` +
    `- 의료 분야: 진단 및 치료 방법 개선\n` +
    `- 교육 분야: 학습 효과 극대화\n` +
    `- 비즈니스 분야: 의사 결정 최적화\n` +
    `- 환경 분야: 지속 가능한 발전 모색\n\n` +
    `이러한 응용 사례들은 ${topic}의 실용적 가치를 입증하고 있습니다.`,

    `## 미래 전망\n\n${topic} 분야의 미래는 매우 밝을 것으로 전망됩니다. ` +
    `기술의 발전과 학문 간 융합이 가속화되면서 이 분야는 ` +
    `더욱 중요한 역할을 하게 될 것입니다.\n\n` +
    `### 단기 전망 (1-5년)\n\n` +
    `단기적으로는 AI와의 결합이 더욱 심화될 것입니다. ` +
    `자동화된 분석 도구와 지능형 시스템이 ${topic} 연구의 ` +
    `효율성을 크게 향상시킬 것으로 예상됩니다.\n\n` +
    `### 중기 전망 (5-10년)\n\n` +
    `중기적으로는 학문 간 경계가 더욱 허물어질 것입니다. ` +
    `${topic}은 다른 학문 분야와의 융합을 통해 ` +
    `새로운 학제적 연구 영역을 창출할 것입니다.\n\n` +
    `### 장기 전망 (10년 이상)\n\n` +
    `장기적으로는 ${topic}의 원리가 우리 사회 전반에 ` +
    `걸쳐 더욱 깊이 통합될 것입니다. 이는 우리의 사고방식과 ` +
    `삶의 질을 근본적으로 변화시킬 잠재력을 가지고 있습니다.`,
  ];

  const conclusion = [
    `## 결론\n\n${topic}은 단순한 학문적 호기심을 넘어 ` +
    `우리 사회와 문명의 발전에 핵심적인 역할을 하고 있습니다. ` +
    `앞으로도 지속적인 연구와 적용을 통해 ${topic}은 ` +
    `인류의 지식과 삶의 질 향상에 기여할 것입니다.\n\n` +
    `이 분야에 대한 깊이 있는 이해는 단순한 지식의 축적을 넘어 ` +
    `세상을 바라보는 새로운 시각을 제공합니다. ` +
    `따라서 ${topic}에 대한 지속적인 학습과 탐구는 ` +
    `개인과 사회의 발전에 중요한 투자가 될 것입니다.`,
  ];

  const tags = generateTags(topic);
  const wikilinks = generateWikilinks(topic);

  return `# ${topic} 종합 분석 - ${noteIndex + 1}\n\n` +
    intro[noteIndex % intro.length] + '\n\n' +
    body[noteIndex % body.length] + '\n\n' +
    conclusion[noteIndex % conclusion.length] + '\n\n' +
    `## 참고 문헌 및 링크\n\n${wikilinks}\n\n` +
    `---\n\n${tags}\n\n` +
    `#긴문서 #${topic.replace(/[/\s]/g, '')} #종합분석`;
}

// ============================================================
// 헬퍼 함수
// ============================================================

function generateTags(topic) {
  const topicTag = topic.replace(/[/\s]/g, '');
  const tags = new Set([
    `#${topicTag}`,
    '#옵시디언',
    '#노트',
    '#지식관리',
  ]);
  
  // 추가 태그
  const extraTags = ['#연구', '#학습', '#참고자료', '#정리', '#요약', '#분석'];
  tags.add(extraTags[Math.floor(Math.random() * extraTags.length)]);
  
  return Array.from(tags).join(' ');
}

function generateWikilinks(topic) {
  const folder = topic.replace(/[/\s]/g, '');
  const relatedTopics = [
    `[[${topic} 입문 가이드]]`,
    `[[${topic} 고급 개념]]`,
    `[[${topic} 참고문헌]]`,
    `[[${topic} 실습 노트]]`,
  ];
  
  // 간혹 다른 폴더 위키링크도 추가
  if (Math.random() > 0.7) {
    const otherTopic = TOPICS[Math.floor(Math.random() * TOPICS.length)].name;
    relatedTopics.push(`[[${otherTopic}]]`);
  }
  
  return relatedTopics.map(l => `- ${l}`).join('\n');
}

function generateFrontmatter(topic, noteIndex) {
  const tags = [
    topic.split('/')[0].toLowerCase(),
    topic.split('/')[1]?.toLowerCase() || 'general',
    'test-data',
    'lumina-benchmark'
  ];
  
  const created = new Date(
    Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)
  ).toISOString().split('T')[0];
  
  return `---
title: "${topic} - Note ${noteIndex + 1}"
created: ${created}
tags: [${tags.map(t => `"${t}"`).join(', ')}]
aliases: ["${topic} Note ${noteIndex + 1}"]
status: "${['draft', 'review', 'final'][Math.floor(Math.random() * 3)]}"
---
`;
}

// ============================================================
// 메인 생성 함수
// ============================================================

function generateNote(topic, noteIndex, sizeCategory) {
  const frontmatter = generateFrontmatter(topic, noteIndex);
  
  let content;
  if (sizeCategory === 'short') {
    content = generateShortContent(topic, noteIndex);
  } else if (sizeCategory === 'medium') {
    content = generateMediumContent(topic, noteIndex);
  } else {
    content = generateLongContent(topic, noteIndex);
  }
  
  return frontmatter + '\n' + content;
}

// ============================================================
// 엔트리 포인트
// ============================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('사용법: node generate-test-vault.js <출력경로> [노트수]');
    console.error('예시:');
    console.error('  node generate-test-vault.js ./test-vault 3000');
    process.exit(1);
  }

  const outputDir = path.resolve(args[0]);
  const totalNotes = parseInt(args[1], 10) || DEFAULT_NOTE_COUNT;

  console.log(`📝 Obsidian-Lumina 테스트 볼트 생성기`);
  console.log(`   출력 경로: ${outputDir}`);
  console.log(`   총 노트 수: ${totalNotes}`);
  console.log(`   주제 수: ${TOPICS.length}`);
  console.log('');

  // 출력 디렉토리 생성
  fs.mkdirSync(outputDir, { recursive: true });

  // 노트당 평균 파일 크기 분포
  // short (< 400자, 청크 1개):medium (400~1000자, 청크 1~2개):long (> 1000자, 청크 2~4개) = 3:4:3
  const sizeDistribution = [
    ...Array(3).fill('short'),
    ...Array(4).fill('medium'),
    ...Array(3).fill('long'),
  ];

  let createdCount = 0;
  const notesPerTopic = Math.max(1, Math.floor(totalNotes / TOPICS.length));
  const extraNotes = totalNotes - notesPerTopic * TOPICS.length;

  for (let ti = 0; ti < TOPICS.length; ti++) {
    const topic = TOPICS[ti];
    const count = notesPerTopic + (ti < extraNotes ? 1 : 0);
    const topicDir = path.join(outputDir, topic.folder);
    fs.mkdirSync(topicDir, { recursive: true });

    for (let ni = 0; ni < count; ni++) {
      const sizeCategory = sizeDistribution[ni % sizeDistribution.length];
      const content = generateNote(topic.name, ni, sizeCategory);
      const safeName = topic.name.replace(/[/\s]/g, '_');
      const filename = `${safeName}_note_${String(ni + 1).padStart(4, '0')}.md`;
      const filepath = path.join(topicDir, filename);
      fs.writeFileSync(filepath, content, 'utf-8');
      createdCount++;

      if (createdCount % 500 === 0) {
        console.log(`   ✅ ${createdCount}/${totalNotes} 노트 생성 완료...`);
      }
    }
  }

  // === .md 이외 확장자 파일도 일부 생성 ===
  // .txt 파일
  const txtDir = path.join(outputDir, 'Attachments/Texts');
  fs.mkdirSync(txtDir, { recursive: true });
  for (let i = 0; i < 50; i++) {
    const content = `Plain text file for testing ${i + 1}\n\nThis is a sample text file that should be indexed by the RAG system.\nIt contains various keywords: embedding, chunking, retrieval, similarity.\n\nReference: [[Test Note for Embedding]]`;
    fs.writeFileSync(path.join(txtDir, `sample_${String(i + 1).padStart(3, '0')}.txt`), content, 'utf-8');
    createdCount++;
  }

  // .csv 파일
  const csvDir = path.join(outputDir, 'Data');
  fs.mkdirSync(csvDir, { recursive: true });
  for (let i = 0; i < 30; i++) {
    const headers = 'id,name,category,description,score';
    const rows = [];
    for (let r = 0; r < 20; r++) {
      const tid = i * 20 + r + 1;
      const cat = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
      const score = (Math.random() * 100).toFixed(2);
      rows.push(`${tid},item_${tid},${cat},description_for_${tid},${score}`);
    }
    fs.writeFileSync(path.join(csvDir, `data_${String(i + 1).padStart(3, '0')}.csv`), headers + '\n' + rows.join('\n'), 'utf-8');
    createdCount++;
  }

  // .json 파일
  for (let i = 0; i < 20; i++) {
    const jsonData = {
      id: i + 1,
      name: `Config ${i + 1}`,
      settings: {
        enabled: true,
        threshold: 0.65,
        maxResults: 5,
      },
      items: Array.from({ length: 10 }, (_, j) => ({
        index: j,
        value: `item_${j}`,
        score: Math.random(),
      })),
    };
    fs.writeFileSync(path.join(csvDir, `config_${String(i + 1).padStart(3, '0')}.json`), JSON.stringify(jsonData, null, 2), 'utf-8');
    createdCount++;
  }

  // .html 파일
  const htmlDir = path.join(outputDir, 'Resources');
  fs.mkdirSync(htmlDir, { recursive: true });
  for (let i = 0; i < 20; i++) {
    const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>Test Page ${i + 1}</title></head>
<body>
<article>
  <h1>HTML Test Document ${i + 1}</h1>
  <p>This is an HTML document for testing RAG indexing. It contains various content elements like lists, tables, and links.</p>
  <h2>Features</h2>
  <ul>
    <li>Paragraph text for embedding</li>
    <li>List items for chunking tests</li>
    <li>Semantic HTML structure</li>
  </ul>
  <p>Reference: <a href="note://TestNote">Test Note</a></p>
</article>
</body>
</html>`;
    fs.writeFileSync(path.join(htmlDir, `page_${String(i + 1).padStart(3, '0')}.html`), html, 'utf-8');
    createdCount++;
  }

  // === 설정 파일 ===
  const dotObsidian = path.join(outputDir, '.obsidian');
  fs.mkdirSync(dotObsidian, { recursive: true });
  
  // .obsidian/app.json
  fs.writeFileSync(path.join(dotObsidian, 'app.json'), JSON.stringify({
    legacySwitch: false,
    promptDelete: false,
    communityPluginSortOrder: 'download',
    communityPlugins: ['obsidian-lumina'],
    attachmentFolderPath: 'Attachments',
    alwaysUpdateLinks: true,
    newFileLocation: 'current',
    newLinkFormat: 'shortest',
    useMarkdownLinks: false,
    showUnsupportedFiles: true,
  }, null, 2), 'utf-8');

  // .obsidian/community-plugins.json
  fs.writeFileSync(path.join(dotObsidian, 'community-plugins.json'), JSON.stringify([
    'obsidian-lumina'
  ], null, 2), 'utf-8');

  // === 생성 요약 ===
  console.log('');
  console.log(`   ✅ 총 ${createdCount}개 파일 생성 완료!`);
  console.log(`   📂 출력 위치: ${outputDir}`);
  console.log('');
  console.log('📊 파일 구성:');
  console.log(`   - 마크다운(.md): ${totalNotes + 0}개 (주제별 ${notesPerTopic}~${notesPerTopic + 1}개)`);
  console.log(`   - 텍스트(.txt): 50개`);
  console.log(`   - CSV(.csv): 30개`);
  console.log(`   - JSON(.json): 20개`);
  console.log(`   - HTML(.html): 20개`);
  console.log(`   - 설정 파일: .obsidian/app.json, community-plugins.json`);
  console.log('');
  console.log('📐 크기 분포 (short:medium:long = 3:4:3):');
  console.log(`   - Short (<400자, 청크 ~1개): 약 ${Math.floor(totalNotes * 0.3)}개`);
  console.log(`   - Medium (400~1000자, 청크 1~2개): 약 ${Math.floor(totalNotes * 0.4)}개`);
  console.log(`   - Long (>1000자, 청크 2~4개): 약 ${Math.floor(totalNotes * 0.3)}개`);
  console.log('');
  console.log('🏷️ 태그 힌트 (검색 테스트용 키워드):');
  console.log(`   - 각 노트에 #주제명 태그 포함`);
  console.log(`   - 위키링크([[링크]])로 노트 간 연결`);
  console.log(`   - YAML frontmatter에 tags/aliases 포함`);
  console.log('');
  console.log('⚡ 테스트 제안:');
  console.log('   1. Obsidian에서 이 볼트 열기');
  console.log('   2. Lumina 플러그인 설정 > RAG 탭에서 "인덱스 초기화 및 재구축" 실행');
  console.log('   3. 인덱싱 진행 상황 모니터링');
  console.log('   4. 다양한 검색 쿼리로 정확도 테스트');
  console.log('   5. 증분 업데이트 테스트: 일부 파일 수정 후 동기화');
  console.log('   6. 대량 파일 삭제 테스트: 일부 폴더 제거 후 증분 업데이트');
}

main();