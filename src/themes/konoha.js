import {NARUTO_CAST} from './cast.js';
export default {
  id:'konoha',label:'木叶 · Q 版火影',environment:'dojo',modelPack:'konoha',chairScale:.8,footrestHeight:.23,
  ui:{background:'#e6dfc9',night:'#283831',accent:'#b66737',control:'#fff8e7',ink:'#697951',border:'#d7c6a6'},
  lighting:{sky:'#fff0ce',ground:'#a2977e',sun:'#ffe4b2',fill:'#e0e8e3',exposure:1.13},
  materials:{
    '#c99b6b':'#a37a4f','#d6ae80':'#c19a68','#e4e4d5':'#e7d5ac','#d8decc':'#d5c299',
    '#f1f0e4':'#725a3c','#e7eadb':'#826343','#b8c1a7':'#927245','#c6ba9f':'#aa936b',
    '#e2c399':'#c7af7c','#d8b98e':'#cfbb8c','#dcc098':'#d5c298','#dfc59f':'#dac8a1','#cdb189':'#baa36e',
    '#536257':'#4e5a42','#a1ad93':'#79885e','#b8c1ab':'#a0ae83','#76866b':'#566741',
    '#c9bc96':'#a4ad77','#b5c1a3':'#bcc192','#b1c0b4':'#c7b586','#c8c1aa':'#b5bd83','#cbb79d':'#bdaf83','#b5c0b8':'#a3b88c',
    '#dad8bc':'#d5cd9e','#c9916d':'#b2714c','#ca9672':'#be8255','#c38d66':'#9d633f','#d2a07b':'#c28e61',
    '#c77e59':'#8c6848','#d89870':'#ad8053','#a1b194':'#8b9766','#b7c3a8':'#a8b682','#e8ddc2':'#d6b87c'
  },
  cast:'naruto',
  characters:{boss:NARUTO_CAST.hiruzen,builder:NARUTO_CAST.naruto,solo:NARUTO_CAST.naruto,reviewer:NARUTO_CAST.sakura,researcher:NARUTO_CAST.sasuke}
};
