const puzzle='530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const hero=document.getElementById('hero-board');
// Illustrative game state; highlights follow SudokuCellUI in the app.
const entries = {2:4, 3:6, 30:7, 40:5, 56:1};
Array.from(puzzle).forEach((n,i)=>{
  const cell=document.createElement('span');
  const value=n==='0'?(entries[i] || ''):n;
  const row=Math.floor(i/9),col=i%9;
  cell.textContent=value;
  cell.classList.add(n==='0'?'entry':'clue');
  if(i===40) cell.classList.add('selected');
  else if(String(value)==='5') cell.classList.add('same-number');
  else if(row===4 || col===4 || (row>=3 && row<=5 && col>=3 && col<=5)) cell.classList.add('peer');
  hero.append(cell);
});
const mini=document.getElementById('mini-sudoku');['2','','7','','5','','9','','1'].forEach(n=>{const s=document.createElement('span');s.textContent=n;mini.append(s)});
// A 5×5 Easy-style illustration with clues computed from its solution.
const nonogramPattern=['01010','11111','11111','01110','00100'];
const nonogram=document.getElementById('nonogram');
const runs = line => line.join('').split('0').filter(Boolean).map(group=>group.length);
const rowClues=nonogramPattern.map(row=>runs([...row]));
const colClues=Array.from({length:5},(_,col)=>runs(nonogramPattern.map(row=>row[col])));
nonogram.setAttribute('role','img');
nonogram.setAttribute('aria-label','Illustrative 5 by 5 LogiGrid puzzle with row and column clues, soft grey filled cells and crosses for empty cells. The final heart cell is selected.');
const corner=document.createElement('div');corner.className='ng-corner';nonogram.append(corner);
colClues.forEach(clues=>{
  const clue=document.createElement('div');clue.className='ng-colclue';
  clues.forEach(value=>{const label=document.createElement('span');label.textContent=value;clue.append(label)});
  nonogram.append(clue);
});
nonogramPattern.forEach((row,r)=>{
  const clue=document.createElement('div');clue.className='ng-rowclue';
  rowClues[r].forEach(value=>{const label=document.createElement('span');label.textContent=value;clue.append(label)});
  nonogram.append(clue);
  [...row].forEach((value,c)=>{
    const cell=document.createElement('div');cell.className='ng-cell';
    if(r===4 || c===2) cell.classList.add('ng-line');
    if(r===4 && c===2) cell.classList.add('ng-selected');
    else if(value==='1') cell.classList.add('ng-filled');
    else cell.classList.add('ng-cross');
    if(r===4)cell.classList.add('ng-last-row');
    if(c===4)cell.classList.add('ng-last-col');
    nonogram.append(cell);
  });
});
const link=document.getElementById('linkgrid');link.setAttribute('aria-label','Illustrative LinkGrid paths');for(let i=0;i<25;i++){const s=document.createElement('span');if([1,11,18].includes(i)){s.className='tile';s.textContent={1:2,11:3,18:2}[i]}else if([6,16,17,13,8].includes(i)){s.className='path'}else if(i===3){s.className='goal';s.textContent='◇'}link.append(s)}
