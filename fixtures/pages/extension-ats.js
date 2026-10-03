window.submitCount=0;window.controlledState={};window.inputEvents=0;
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submitCount++;});
document.querySelector('form').addEventListener('input',event=>{window.controlledState[event.target.name]=event.target.value;window.inputEvents++;document.querySelector('#events').textContent=`${window.inputEvents} input events observed`;});
document.querySelector('#next').addEventListener('click',()=>{document.querySelector('#step1').hidden=true;document.querySelector('#step2').hidden=false;});
