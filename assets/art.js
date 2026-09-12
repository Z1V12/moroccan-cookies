/* art.js — איורי SVG פרוצדורליים לעוגיות. קוד, לא נתונים. */
const S={
  crescent:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><path d="M68 16a40 40 0 1 0 0 68 46 46 0 0 1 0-68Z" fill="${a}"/><circle cx="44" cy="38" r="3" fill="${b}" opacity=".7"/><circle cx="38" cy="55" r="2.4" fill="${b}" opacity=".7"/>`,
  bow:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><path d="M50 50c-14-16-34-12-30 2s24 14 30-2Zm0 0c14-16 34-12 30 2s-24 14-30-2Z" fill="${a}"/><circle cx="50" cy="50" r="7" fill="${a}"/><path d="M24 66c8 4 16 4 22 0M54 66c8 4 14 4 22 0" stroke="${a}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".6"/>`,
  flower:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><g fill="${a}">${[0,45,90,135,180,225,270,315].map(d=>`<ellipse cx="50" cy="26" rx="9" ry="15" transform="rotate(${d} 50 50)"/>`).join("")}</g><circle cx="50" cy="50" r="11" fill="${b}"/><circle cx="50" cy="50" r="5.5" fill="${a}"/>`,
  dome:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><circle cx="50" cy="52" r="30" fill="${a}"/><path d="M35 44c6 5 10 5 16 1M42 62c7 3 12 2 18-3M50 34v9M62 50l6-4" stroke="${b}" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".85"/>`,
  triangle:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><path d="M50 22 78 70H22Z" fill="${a}" rx="6"/><path d="M50 22 36 46M50 22 64 46M36 70 64 70" stroke="${b}" stroke-width="3" opacity=".65" fill="none"/>`,
  diamond:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><path d="M50 20 80 50 50 80 20 50Z" fill="${a}"/><path d="M36 50h28M50 36v28" stroke="${b}" stroke-width="3.4" opacity=".7"/>`,
  spiral:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><path d="M50 22a28 28 0 1 1-19.8 47.8A22 22 0 1 0 50 32a17 17 0 1 0 12 29" stroke="${a}" stroke-width="9" fill="none" stroke-linecap="round"/>`,
  rosette:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><g fill="${a}">${[0,60,120,180,240,300].map(d=>`<circle cx="50" cy="31" r="12" transform="rotate(${d} 50 50)"/>`).join("")}</g><circle cx="50" cy="50" r="13" fill="${a}"/><circle cx="50" cy="50" r="7" fill="${b}"/>`,
  ball:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><circle cx="50" cy="50" r="29" fill="${a}"/><g fill="${b}" opacity=".8"><circle cx="43" cy="42" r="2.6"/><circle cx="57" cy="45" r="2.2"/><circle cx="48" cy="57" r="2.4"/><circle cx="60" cy="58" r="2"/><circle cx="38" cy="53" r="2"/></g>`,
  square:(a,b)=>`<circle cx="50" cy="50" r="42" fill="${b}"/><rect x="24" y="24" width="52" height="52" rx="13" fill="${a}"/><path d="M36 44h28M36 56h28" stroke="${b}" stroke-width="3.6" stroke-linecap="round"/>`
};
const svg=(shape,a,b)=>`<svg viewBox="0 0 100 100" aria-hidden="true">${S[shape](a,b)}</svg>`;
