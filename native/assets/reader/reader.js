function renderNote(content, dark, fontSize, reset) {
  const scroll = reset ? 0 : window.scrollY;
  document.documentElement.dataset.dark = String(dark);
  document.body.style.fontSize = fontSize + 'px';
  const main = document.querySelector('main');
  main.innerHTML = content;
  let errors = 0;
  main.querySelectorAll('[data-tex]').forEach(el => {
    const tex = el.getAttribute('data-tex');
    try {
      katex.render(tex, el, {displayMode:el.classList.contains('math-display'), throwOnError:true, trust:false, strict:'ignore', maxExpand:1000, maxSize:30, output:'htmlAndMathml'});
    } catch (error) {
      errors++;
      el.classList.add('math-error');
      el.textContent = '수식 표기를 확인할 수 없습니다. 원문 수식: ';
      const code = document.createElement('code'); code.textContent = tex; el.append(code);
    }
  });
  document.documentElement.dataset.mathErrors = String(errors);
  // Keep precise source locators, but give them a quieter typographic role.
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return node.parentElement.closest('code,pre,[data-tex],a,button,figcaption') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const matches = [...node.textContent.matchAll(/\[Source:\s*([^\]]+)\]/gi)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    matches.forEach(match => {
      fragment.append(document.createTextNode(node.textContent.slice(offset, match.index)));
      const page = match[1].match(/\bp{1,2}\.\s*(\d+)/i);
      const ref = document.createElement(page && window.ipc ? 'button' : 'span');
      ref.className = 'source-ref';
      ref.textContent = '원문 · ' + match[1];
      ref.title = match[0];
      if (page && window.ipc) { ref.dataset.page = page[1]; ref.setAttribute('aria-label', '원문 ' + match[1] + ' 열기'); }
      fragment.append(ref);
      offset = match.index + match[0].length;
    });
    fragment.append(document.createTextNode(node.textContent.slice(offset)));
    node.replaceWith(fragment);
  });
  main.querySelectorAll('table').forEach(table => {
    const wrapper = document.createElement('div'); wrapper.className='table-scroll'; wrapper.tabIndex=0; wrapper.setAttribute('role','region'); wrapper.setAttribute('aria-label','표');
    table.replaceWith(wrapper); wrapper.append(table);
  });
  window.scrollTo(0, scroll);
}
function send(message) { if(window.ipc) window.ipc.postMessage(JSON.stringify(message)); }
let zoomScale = 1;
function setImageZoom(scale) {
  zoomScale = Math.max(.5, Math.min(4, scale));
  const dialog = document.querySelector('dialog');
  dialog.querySelector('img').style.width = Math.round(dialog.querySelector('.zoom-viewport').clientWidth * zoomScale) + 'px';
  dialog.querySelector('[data-zoom-label]').textContent = Math.round(zoomScale*100) + '%';
}
function enlargeImage(image) {
  const dialog = document.querySelector('dialog');
  dialog.querySelector('img').src=image.src; dialog.querySelector('img').alt=image.alt;
  dialog.showModal(); setImageZoom(1.5);
}
document.addEventListener('click', event => {
  const page = event.target.closest('[data-page]');
  if(page) { send({page:Number(page.dataset.page)}); return; }
  const image = event.target.closest('.visual img');
  if(image) { enlargeImage(image); return; }
  const link=event.target.closest('a');
  if(link && /^https?:\/\//.test(link.href) && window.ipc) { event.preventDefault(); send({url:link.href}); }
});
document.addEventListener('keydown', event => {
  if(event.key==='Enter' && event.target.matches('.visual img')) { enlargeImage(event.target); event.preventDefault(); }
});
document.querySelector('[data-close]').addEventListener('click',()=>document.querySelector('dialog').close());
document.querySelector('[data-zoom-in]').addEventListener('click',()=>setImageZoom(zoomScale*1.25));
document.querySelector('[data-zoom-out]').addEventListener('click',()=>setImageZoom(zoomScale/1.25));
document.querySelector('[data-zoom-fit]').addEventListener('click',()=>setImageZoom(1));
window.noteReady = true;
