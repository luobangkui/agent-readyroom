import konoha from './konoha.js';

export default {
  ...konoha,id:'konoha-courtyard',label:'木叶庭院',environment:'courtyard',
  ui:{background:'#e8dfcf',night:'#253530',accent:'#a86b42',control:'#fffaf0',ink:'#65583e',border:'#d3bfa0'},
  lighting:{sky:'#fff3da',ground:'#927a61',sun:'#ffe5b4',fill:'#dce8dd',exposure:1.08,sunIntensity:3.2,hemiIntensity:2.15,fillIntensity:1.05,sunPosition:[-3,9,-7]},
  materials:{...konoha.materials,'#c99b6b':'#b7814b','#d6ae80':'#d9ad72','#536257':'#665741','#a1ad93':'#899071','#b8c1ab':'#a0a488','#8c9f94':'#8e9a76','#53655d':'#667450','#b4bfb5':'#bdb596','#cdd3c8':'#ded6bd','#c9916d':'#e4d8ba','#667b60':'#dacfad','#c6a579':'#e1d4b6','#90a69b':'#bec5a1','#b6a481':'#d6ccae'}
};
