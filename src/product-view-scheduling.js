// UI-only work. Persistence and model operations never wait for animation frames.
export function frameScheduler(win, work) {
  let pending = null, disposed = false;
  const cancel = () => { if (pending !== null) win.cancelAnimationFrame(pending); pending = null; };
  return {
    request() { if (!disposed && pending === null) pending = win.requestAnimationFrame(() => { pending = null; if (!disposed) work(); }); },
    flush() { cancel(); if (!disposed) work(); },
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}

// Only clone fields consumed by the visible view. Never expose live mutable data.
// This is a synchronous render accessor, not a persistence/async snapshot API.
export function lazyViewState(readers) {
  const view = {};
  for (const [key, read] of Object.entries(readers)) Object.defineProperty(view, key, {
    enumerable: true, configurable: true,
    get() { const value = read(); Object.defineProperty(view, key, { value, enumerable: true }); return value; },
  });
  return view;
}

export const readViewState = app => app.readViewState?.() ?? app.state;

// Keep unchanged cards and their focused controls/disclosures mounted. Parsing
// happens only when memory/filter inputs changed, never for a log/progress tick.
export function reconcileMemoryList(container, html) {
  const template=container.ownerDocument.createElement('template');template.innerHTML=html;
  const key=(node,index)=>node.dataset?.recordId?`record:${node.dataset.recordId}`:node.dataset?.profile?`person:${node.dataset.profile}`:`other:${index}`;
  const old=new Map([...container.children].map((node,index)=>[key(node,index),node]));
  const incomingNodes=[...template.content.children],keys=new Set(incomingNodes.map(key));
  for(const [id,node] of old)if(!keys.has(id))node.remove();
  const updated=[];let cursor=container.firstChild;
  for(const [index,incoming] of incomingNodes.entries()){
    const existing=old.get(key(incoming,index));
    const node=existing?.isEqualNode(incoming)?existing:incoming;
    if(node===incoming)updated.push(node);
    if(existing&&node!==existing){if(cursor===existing)cursor=existing.nextSibling;existing.remove();}
    if(node===cursor)cursor=cursor.nextSibling;
    else container.insertBefore(node,cursor);
  }
  while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
  return updated;
}
