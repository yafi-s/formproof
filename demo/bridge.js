// A localhost-only emulator for the controlled demo; not included by manifest.json.
// The actual extension uses chrome.scripting and does not eval page strings.
const target = () => parent.document.getElementById('application')?.contentWindow;
window.chrome={
  storage:{local:{async setAccessLevel(){},async get(){return {vault:JSON.parse(localStorage.getItem('formproof-demo-vault')||'null')};},
    async set({vault}){localStorage.setItem('formproof-demo-vault',JSON.stringify(vault));},
    async remove(){localStorage.removeItem('formproof-demo-vault');}}},
  tabs:{async query(){const frame=target();if(!frame)throw new Error('Use the controlled demo parent page');return [{id:4242,url:frame.location.href}];}},
  scripting:{async executeScript(request){
    if(request.target.tabId!==4242)throw new Error('Only the controlled mock tab is available');
    const frame=target();if(frame.location.origin!==location.origin)throw new Error('Mock page must have the same local origin');
    const fn=frame.eval(`(${request.func.toString()})`);return [{result:fn(...(request.args??[]))}];
  }}
};
