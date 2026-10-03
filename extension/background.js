// Keep one review window, bound only by explicit toolbar invocation to a tab.
// Background code never receives a passphrase, resume text or profile facts.
let openChain=Promise.resolve();
chrome.action.onClicked.addListener(tab=>{
  openChain=openChain.catch(()=>{}).then(async()=>{
    if(!Number.isSafeInteger(tab.id))return;
    const stored=await chrome.storage.session.get('workspaceWindow');
    await chrome.storage.session.set({targetTabId:tab.id});
    if(Number.isSafeInteger(stored.workspaceWindow)){
      try{
        await chrome.windows.update(stored.workspaceWindow,{focused:true});
        await chrome.runtime.sendMessage({type:'formproof-target-changed',tabId:tab.id}).catch(()=>{});
        return;
      }catch{/* The previous window was closed. */}
    }
    const view=await chrome.windows.create({url:chrome.runtime.getURL('popup.html'),type:'popup',width:740,height:860});
    await chrome.storage.session.set({workspaceWindow:view.id});
  });
});
