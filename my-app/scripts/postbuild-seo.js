const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '../build');
const BASE_URL = 'https://smartdocq.vercel.app';

if (!fs.existsSync(BUILD_DIR)) {
  console.error('Build directory does not exist. Run react-scripts build first.');
  process.exit(1);
}

const baseHtmlPath = path.join(BUILD_DIR, 'index.html');
const baseHtml = fs.readFileSync(baseHtmlPath, 'utf8');

const pages = [
  {
    route: '/',
    filePath: path.join(BUILD_DIR, 'index.html'),
    title: 'SmartDocQ – AI PDF Chat, Document Summarizer & Research Assistant',
    canonical: `${BASE_URL}/`,
    rootContent: `
      <main>
        <h1>Your documents. Now you can talk to them.</h1>
        <p>Chat with PDFs, get citation-backed answers, summarize documents, and create quizzes and flashcards. Supports PDF, Word, Excel, CSV, and TXT.</p>
        <nav aria-label="Footer Links">
          <a href="/help">Help Center</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </nav>
      </main>
    `.trim()
  },
  {
    route: '/help',
    filePath: path.join(BUILD_DIR, 'help', 'index.html'),
    title: 'Help Center - SmartDocQ',
    canonical: `${BASE_URL}/help`,
    rootContent: `
      <main>
        <h1>SmartDocQ Help Center</h1>
        <p>Search documentation, quick-start guides, security compliance details, and FAQs.</p>
        <nav aria-label="Breadcrumb">
          <a href="/">Home</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </nav>
      </main>
    `.trim()
  },
  {
    route: '/privacy',
    filePath: path.join(BUILD_DIR, 'privacy', 'index.html'),
    title: 'Privacy Policy - SmartDocQ',
    canonical: `${BASE_URL}/privacy`,
    rootContent: `
      <main>
        <h1>SmartDocQ Privacy Policy</h1>
        <p>Information on data collection, privacy practices, and document security.</p>
        <nav aria-label="Breadcrumb">
          <a href="/">Home</a>
          <a href="/help">Help Center</a>
        </nav>
      </main>
    `.trim()
  },
  {
    route: '/terms',
    filePath: path.join(BUILD_DIR, 'terms', 'index.html'),
    title: 'Terms of Service - SmartDocQ',
    canonical: `${BASE_URL}/terms`,
    rootContent: `
      <main>
        <h1>SmartDocQ Terms of Service</h1>
        <p>Usage guidelines, system limitations, and service policies of SmartDocQ.</p>
        <nav aria-label="Breadcrumb">
          <a href="/">Home</a>
          <a href="/help">Help Center</a>
        </nav>
      </main>
    `.trim()
  }
];

function injectSeo(html, { title, canonical, rootContent }) {
  let result = html;

  // Replace <title> tag
  if (title) {
    result = result.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
  }

  // Inject or update <link rel="canonical"> tag in <head>
  const canonicalTag = `<link rel="canonical" href="${canonical}" />`;
  const canonicalRegex = /<link\s+rel=["']canonical["']\s+href=["'][^"']*["']\s*\/?>/i;
  if (canonicalRegex.test(result)) {
    result = result.replace(canonicalRegex, canonicalTag);
  } else {
    result = result.replace('</head>', `  ${canonicalTag}\n  </head>`);
  }

  // Replace empty <div id="root"></div> with minimal crawlable HTML (visually hidden to prevent pre-hydration flash)
  const rootElement = `<div id="root"><div aria-hidden="true" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;">${rootContent}</div></div>`;
  result = result.replace(/<div id="root">\s*<\/div>/i, rootElement);

  return result;
}

console.log('Generating post-build static SEO HTML files...');

pages.forEach((page) => {
  const pageHtml = injectSeo(baseHtml, page);
  const dir = path.dirname(page.filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(page.filePath, pageHtml, 'utf8');
  console.log(`  ✓ Generated static SEO HTML for route '${page.route}' -> ${path.relative(BUILD_DIR, page.filePath)}`);
});

console.log('Post-build static SEO HTML generation complete.');
