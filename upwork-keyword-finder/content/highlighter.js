// content/highlighter.js

var HIGHLIGHT_COLORS = {
  high:   { bg: '#FFF176', border: '#F9A825' },
  medium: { bg: '#E8F5E9', border: '#66BB6A' },
  low:    { bg: '#E3F2FD', border: '#42A5F5' }
};

function highlightKeywordsOnPage(keywords) {
  clearHighlights();
  
  if (!keywords || keywords.length === 0) return;
  
  // Sort by keyword length desc (longer phrases first)
  const sorted = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length);
  
  // Target only job tile text areas
  const targets = document.querySelectorAll(
    '[data-test="JobTile"] h2, [data-test="JobTile"] [data-test="UpCLineClamp JobDescription"] p'
  );
  
  targets.forEach(element => {
    sorted.forEach(({ keyword, importance }) => {
      if (!keyword || keyword.length < 3) return;
      highlightInElement(element, keyword, importance || 'low');
    });
  });
}

function highlightInElement(element, keyword, importance) {
  const color = HIGHLIGHT_COLORS[importance] || HIGHLIGHT_COLORS.low;
  const style = `background:${color.bg};border:1px solid ${color.border};border-radius:3px;padding:0 2px`;
  const regex = new RegExp(`\\b(${escapeRegex(keyword)})\\b`, 'gi');
  
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  
  textNodes.forEach(textNode => {
    if (!regex.test(textNode.textContent)) return;
    regex.lastIndex = 0;
    
    const span = document.createElement('span');
    span.innerHTML = textNode.textContent.replace(regex, 
      `<mark class="ukf-hl ukf-${importance}" style="${style}" data-ukf="${keyword}">$1</mark>`
    );
    textNode.parentNode.replaceChild(span, textNode);
  });
}

function clearHighlights() {
  document.querySelectorAll('.ukf-hl').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
  // Clean up empty spans left behind
  document.querySelectorAll('span:empty').forEach(el => el.remove());
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
