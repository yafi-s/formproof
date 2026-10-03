for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{
  document.getElementById('application').src=`/fixtures/pages/${button.dataset.page}.html`;
});
