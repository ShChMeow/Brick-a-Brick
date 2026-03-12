// ===== 砖了个砖 - 游戏核心逻辑 =====
// 「砖块」是棋盘上的小方块，每个砖块有一个图标（emoji）。
// 两个相同图标的砖块在同一行或同一列、中间没有其他砖块时，可以「连线消除」。
// 玩家可以点击或拖拽砖块来移动它们，移动后如果形成连线就消除，否则弹性回原位。

// ===== 常量配置 =====
const COLS = 10;
const ROWS = 14;
const TOTAL = COLS * ROWS; // 140
// 动态尺寸 — 根据屏幕宽度自适应
let CELL = 40;
let GAP = 2;
let PAD = 4;
let BRICK = 36;
let STEP = CELL + GAP;

function calcSizes() {
  // 可用宽度：视口宽度减去左右安全边距
  const vw = Math.min(window.innerWidth, document.documentElement.clientWidth);
  const maxBoardW = vw - 16; // 左右各留 8px
  // 棋盘宽度 = PAD*2 + COLS*CELL + (COLS-1)*GAP，反推 CELL
  // 先用默认 GAP=2, PAD=4 算出 CELL 上限
  const idealCell = Math.floor((maxBoardW - 8 - (COLS - 1) * 2) / COLS);
  CELL = Math.min(40, Math.max(20, idealCell)); // 限制在 20~40px
  GAP = CELL >= 30 ? 2 : 1;
  PAD = CELL >= 30 ? 4 : 2;
  BRICK = CELL - 4;
  STEP = CELL + GAP;
}

const ICONS = [
  '🔴','🔵','🟢','🟡','🟣','🟠','⭐','💎','🌙','❤️',
  '🍀','🔶','🌸','⚡','🎯','🪨','🍎','🐱','🎵','🌈'
];
const COLORS = [
  '#c0392b','#2980b9','#27ae60','#f1c40f','#8e44ad','#e67e22',
  '#f39c12','#1abc9c','#2c3e50','#e74c3c','#16a085','#d35400',
  '#9b59b6','#3498db','#e94560','#7f8c8d','#e74c3c','#f39c12',
  '#1abc9c','#8e44ad'
];

const DIFFICULTY = [
  { name: '初级', typeCount: 5 },
  { name: '中级', typeCount: 7 },
  { name: '进阶', typeCount: 10 },
  { name: '高级', typeCount: 14 },
  { name: '大师', typeCount: 18 },
  { name: '地狱', typeCount: 20 },
];

// 额外 emoji 池，当定制关卡类别数超过 ICONS 数量时使用
const EXTRA_EMOJI = [
  '🍊','🍋','🍇','🍉','🍓','🍒','🥝','🍑','🥭','🍍',
  '🌻','🌺','🌹','🌷','🌼','🍄','🦋','🐝','🐞','🦊',
  '🐼','🐨','🦁','🐸','🐙','🦀','🐳','🦄','🐲','🎃',
  '🎪','🎭','🎨','🎲','🎸','🎺','🎻','🏀','⚽','🏈',
  '🚀','✈️','🚂','🏰','🗼','🌋','🏝️','🎄','🔔','🎁'
];

// ===== 游戏状态 =====
let grid = [];
let level = 1;
let diffIdx = 0;
let customMode = false;   // 是否处于定制关卡模式
let customTypeCount = 10; // 定制关卡的砖块类别数
let selected = null;      // 当前选中的砖块 { r, c }
let candidates = [];      // 选中后可配对消除的候选砖块列表 [{ r, c }, ...]
let hintPair = null;
let dragging = null;
let brickEls = {};
let animating = false;
let disabledIcons = new Set();
let sliceMode = false;     // 是否处于切片图片模式（识别关卡）
let sliceImageMap = {};    // type → DataURL（每种砖块的代表切片图）
let undoStack = [];        // 撤回栈：每步保存 grid 快照
let redoStack = [];        // 取消撤回栈

const board = document.getElementById('board');
const wrapper = document.getElementById('board-wrapper');
const levelEl = document.getElementById('level');
const diffEl = document.getElementById('difficulty');

// ===== 坐标转换 =====
function cellX(c) { return PAD + c * STEP + (CELL - BRICK) / 2; }
function cellY(r) { return PAD + r * STEP + (CELL - BRICK) / 2; }

// ===== 获取砖块图标和颜色（支持超过20种时用额外emoji池）=====
function getIcon(type) {
  if (type < ICONS.length) return ICONS[type];
  return EXTRA_EMOJI[(type - ICONS.length) % EXTRA_EMOJI.length];
}
function getColor(type) {
  if (type < COLORS.length) return COLORS[type];
  // 超出预设颜色时，用 HSL 均匀分布生成
  const hue = (type * 137) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

// ===== 更新上一关按钮状态 =====
function updatePrevBtn() {
  const btn = document.getElementById('prev-btn');
  if (btn) btn.disabled = (level <= 1);
}

// ===== 初始化关卡 =====
function initLevel() {
  // 非识别模式的关卡切换时，退出切片模式
  sliceMode = false;
  sliceImageMap = {};
  let typeCount;
  if (customMode) {
    typeCount = customTypeCount;
    levelEl.textContent = '定制';
    diffEl.textContent = typeCount + '种砖块';
  } else {
    diffIdx = Math.min(Math.floor((level - 1) / 3), DIFFICULTY.length - 1);
    const diff = DIFFICULTY[diffIdx];
    levelEl.textContent = level;
    diffEl.textContent = diff.name;
    typeCount = diff.typeCount;
  }
  updatePrevBtn();

  // 获取可用图标（排除被禁用的）
  const enabledList = getEnabledIcons(typeCount);
  const actualCount = Math.max(2, enabledList.length);

  // 保证每种砖块数量都是偶数（成对出现），避免出现无法通关的死局。
  // TOTAL 必须是偶数（140），所以总共需要 TOTAL/2 = 70 对砖块。
  const totalPairs = TOTAL / 2; // 70 对
  let bricks = [];
  // 先给每种砖块平均分配对数
  const basePairs = Math.floor(totalPairs / actualCount); // 每种至少这么多对
  let remaining = totalPairs - basePairs * actualCount;   // 剩余的对数
  for (let t = 0; t < actualCount; t++) {
    // 前 remaining 种砖块各多分一对，保证总数刚好
    const pairs = basePairs + (t < remaining ? 1 : 0);
    for (let p = 0; p < pairs; p++) {
      bricks.push(enabledList[t]);
      bricks.push(enabledList[t]);
    }
  }

  // Fisher-Yates 洗牌
  for (let i = bricks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bricks[i], bricks[j]] = [bricks[j], bricks[i]];
  }

  grid = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = bricks[idx++];
    }
  }

  selected = null;
  candidates = [];
  hintPair = null;
  animating = false;
  undoStack = [];
  redoStack = [];
  updateUndoRedoBtns();
  render();
}

// ===== 撤回/取消撤回 =====
function saveUndoState() {
  undoStack.push(grid.map(r => [...r]));
  redoStack = []; // 新操作清空 redo
  updateUndoRedoBtns();
}
function undo() {
  if (undoStack.length === 0 || animating) return;
  redoStack.push(grid.map(r => [...r]));
  grid = undoStack.pop();
  selected = null; candidates = []; hintPair = null;
  updateUndoRedoBtns();
  render();
}
function redo() {
  if (redoStack.length === 0 || animating) return;
  undoStack.push(grid.map(r => [...r]));
  grid = redoStack.pop();
  selected = null; candidates = []; hintPair = null;
  updateUndoRedoBtns();
  render();
}
function updateUndoRedoBtns() {
  const ub = document.getElementById('undo-btn');
  const rb = document.getElementById('redo-btn');
  if (ub) ub.disabled = undoStack.length === 0;
  if (rb) rb.disabled = redoStack.length === 0;
}

// ===== 渲染棋盘 =====
function render() {
  calcSizes();
  board.style.gridTemplateColumns = `repeat(${COLS}, ${CELL}px)`;
  board.style.gridTemplateRows = `repeat(${ROWS}, ${CELL}px)`;
  board.style.gap = GAP + 'px';
  board.style.padding = PAD + 'px';
  board.innerHTML = '';
  brickEls = {};

  const bw = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
  const bh = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP;
  wrapper.style.width = bw + 'px';
  wrapper.style.height = bh + 'px';

  wrapper.querySelectorAll('.brick, .connect-line').forEach(el => el.remove());

  // 底层格子
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.style.width = CELL + 'px';
      cell.style.height = CELL + 'px';
      board.appendChild(cell);
    }
  }

  // 砖块
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] < 0) continue;
      const type = grid[r][c];
      const el = document.createElement('div');
      el.className = 'brick';
      el.style.left = cellX(c) + 'px';
      el.style.top = cellY(r) + 'px';
      el.style.width = BRICK + 'px';
      el.style.height = BRICK + 'px';
      el.style.fontSize = Math.max(10, BRICK - 16) + 'px';
      // 切片模式：用切片图片显示；普通模式：用 emoji + 颜色
      if (sliceMode && sliceImageMap[type]) {
        el.style.background = 'none';
        el.style.padding = '0';
        el.style.overflow = 'hidden';
        const img = document.createElement('img');
        img.src = sliceImageMap[type];
        img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none;';
        el.appendChild(img);
      } else {
        el.style.background = getColor(type);
        el.textContent = getIcon(type);
      }
      el.dataset.r = r;
      el.dataset.c = c;

      if (selected && selected.r === r && selected.c === c) {
        el.classList.add('selected');
      }
      // 候选高亮：选中一个砖块后，所有可配对的同色砖块闪光
      if (candidates.some(cd => cd.r === r && cd.c === c)) {
        el.classList.add('candidate');
      }
      if (hintPair && ((hintPair[0].r === r && hintPair[0].c === c) ||
          (hintPair[1].r === r && hintPair[1].c === c))) {
        el.classList.add('hint');
      }

      el.addEventListener('mousedown', e => { e.preventDefault(); startDrag(e, r, c); });
      el.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e.touches[0], r, c); }, { passive: false });

      wrapper.appendChild(el);
      brickEls[r + ',' + c] = el;
    }
  }
}

// ===== 连线判断 =====
function canConnect(r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return false;
  if (r1 === r2) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo + 1; c < hi; c++) if (grid[r1][c] >= 0) return false;
    return true;
  }
  if (c1 === c2) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) if (grid[r][c1] >= 0) return false;
    return true;
  }
  return false;
}

// ===== 找出某个砖块的所有可连线消除的同色砖块 =====
function findCandidates(r, c) {
  const type = grid[r][c];
  const result = [];
  for (let rr = 0; rr < ROWS; rr++) {
    for (let cc = 0; cc < COLS; cc++) {
      if (rr === r && cc === c) continue;
      if (grid[rr][cc] === type && canConnect(r, c, rr, cc)) {
        result.push({ r: rr, c: cc });
      }
    }
  }
  return result;
}

// ===== 点击逻辑 =====
// 需求3：点击砖块后，自动找出所有可配对的同色砖块高亮（候选），
//        玩家再点击某个候选砖块完成消除。
function handleClick(r, c) {
  if (animating) return;
  if (grid[r]?.[c] < 0) return;
  hintPair = null;

  // 如果点击的是候选砖块 → 消除
  if (selected && candidates.some(cd => cd.r === r && cd.c === c)) {
    animating = true;
    candidates = [];
    saveUndoState();
    removePairAnimated(selected.r, selected.c, r, c);
    selected = null;
    return;
  }

  // 点击已选中的砖块 → 取消选中
  if (selected && selected.r === r && selected.c === c) {
    selected = null;
    candidates = [];
    render();
    return;
  }

  // 选中新砖块，计算候选
  selected = { r, c };
  candidates = findCandidates(r, c);
  // 需求1：只有1个候选时自动消除，不需要用户再点
  if (candidates.length === 1) {
    animating = true;
    const target = candidates[0];
    candidates = [];
    saveUndoState();
    removePairAnimated(r, c, target.r, target.c);
    selected = null;
    return;
  }
  render();
}

// ===== 拖拽系统 =====
function startDrag(e, r, c) {
  if (animating || grid[r][c] < 0) return;
  hintPair = null;

  dragging = {
    r, c,
    startX: e.clientX,
    startY: e.clientY,
    locked: false,    // 是否已锁定方向
    horizontal: true, // 锁定后的方向
    chain: [],        // 被推动的砖块队列（仅移动方向前方的）
    origPositions: [],
    maxSteps: 0,      // 最大可移动格数
    dir: 1,           // 移动方向 +1 或 -1
  };

  const onMove = ev => {
    ev.preventDefault();
    const pt = ev.touches ? ev.touches[0] : ev;
    handleDragMove(pt);
  };
  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
    handleDragEnd(pt);
  };

  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

// 需求2：只推移动方向前方的连续砖块，后方的不动
// 例如一行有 A B C，向右拖 B → B 推着 C 一起向右，A 不动
function setupDragChain() {
  const { r, c, horizontal, dir } = dragging;
  const chain = [{ r, c }];

  // 只向移动方向（dir）找连续砖块
  let nr = r, nc = c;
  while (true) {
    nr += horizontal ? 0 : dir;
    nc += horizontal ? dir : 0;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
    if (grid[nr][nc] < 0) break; // 遇到空格，停止
    chain.push({ r: nr, c: nc });
  }

  // 继续往前数空格，算出最大可移动步数
  let maxSteps = 0;
  while (true) {
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
    if (grid[nr][nc] >= 0) break; // 遇到另一个砖块或边界
    maxSteps++;
    nr += horizontal ? 0 : dir;
    nc += horizontal ? dir : 0;
  }

  dragging.chain = chain;
  dragging.origPositions = chain.map(p => ({ x: cellX(p.c), y: cellY(p.r) }));
  dragging.maxSteps = maxSteps;
}

function handleDragMove(pt) {
  if (!dragging) return;
  const dx = pt.clientX - dragging.startX;
  const dy = pt.clientY - dragging.startY;

  // 需求1：锁定方向后，砖块自由跟随鼠标滑动（不限一格）
  if (!dragging.locked) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    dragging.horizontal = Math.abs(dx) >= Math.abs(dy);
    // 确定移动方向 dir
    if (dragging.horizontal) {
      dragging.dir = dx > 0 ? 1 : -1;
    } else {
      dragging.dir = dy > 0 ? 1 : -1;
    }
    dragging.locked = true;
    setupDragChain();
  }

  // 沿移动方向的偏移量（只允许 dir 方向移动）
  let offset = dragging.horizontal ? dx : dy;
  const maxPx = dragging.maxSteps * STEP;

  if (dragging.dir > 0) {
    offset = Math.max(0, Math.min(maxPx, offset));
  } else {
    offset = Math.min(0, Math.max(-maxPx, offset));
  }

  dragging.chain.forEach((pos, i) => {
    const el = brickEls[pos.r + ',' + pos.c];
    if (!el) return;
    const orig = dragging.origPositions[i];
    if (dragging.horizontal) {
      el.style.left = (orig.x + offset) + 'px';
    } else {
      el.style.top = (orig.y + offset) + 'px';
    }
  });
}

function handleDragEnd(pt) {
  if (!dragging) return;
  const dx = pt.clientX - dragging.startX;
  const dy = pt.clientY - dragging.startY;

  // 几乎没移动 → 当作点击
  if (!dragging.locked || (Math.abs(dx) < 6 && Math.abs(dy) < 6)) {
    const cr = dragging.r, cc = dragging.c;
    dragging = null;
    handleClick(cr, cc);
    return;
  }

  let offset = dragging.horizontal ? dx : dy;
  const maxPx = dragging.maxSteps * STEP;
  if (dragging.dir > 0) {
    offset = Math.max(0, Math.min(maxPx, offset));
  } else {
    offset = Math.min(0, Math.max(-maxPx, offset));
  }

  let gridSteps = Math.round(offset / STEP); // 对齐到最近的格子
  if (gridSteps === 0) {
    bounceBack();
    dragging = null;
    return;
  }

  // 尝试移动：备份 grid，执行移动
  const backup = grid.map(row => [...row]);
  const chain = dragging.chain;
  const types = chain.map(p => grid[p.r][p.c]);

  // 清空原位置
  chain.forEach(p => { grid[p.r][p.c] = -1; });

  // 放到新位置
  const newPositions = chain.map(p => ({
    r: p.r + (dragging.horizontal ? 0 : gridSteps),
    c: p.c + (dragging.horizontal ? gridSteps : 0),
  }));
  newPositions.forEach((p, i) => { grid[p.r][p.c] = types[i]; });

  // 需求5：只有被拖拽的砖块（chain[0]，即玩家按住的那个）才能触发消除
  const draggedBrick = newPositions[0];
  const draggedType = types[0];
  const pair = findMatchForBrick(draggedBrick.r, draggedBrick.c, draggedType);

  if (pair) {
    animating = true;
    const savedDragging = { ...dragging, chain: [...chain] };
    saveUndoState();
    snapToGrid(chain, newPositions, () => {
      render();
      removePairAnimated(pair[0].r, pair[0].c, pair[1].r, pair[1].c);
    });
    dragging = null;
    return;
  }

  // 需求4：没有消除 → 恢复 grid，弹性回原位
  for (let rr = 0; rr < ROWS; rr++) grid[rr] = backup[rr];
  bounceBack();
  dragging = null;
}

// 需求5：只检查指定砖块是否能与某个同色砖块连线消除
function findMatchForBrick(r, c, type) {
  for (let rr = 0; rr < ROWS; rr++) {
    for (let cc = 0; cc < COLS; cc++) {
      if (rr === r && cc === c) continue;
      if (grid[rr][cc] === type && canConnect(r, c, rr, cc)) {
        return [{ r, c }, { r: rr, c: cc }];
      }
    }
  }
  return null;
}

function snapToGrid(oldChain, newPositions, callback) {
  oldChain.forEach((p, i) => {
    const el = brickEls[p.r + ',' + p.c];
    if (!el) return;
    el.classList.add('sliding');
    el.style.left = cellX(newPositions[i].c) + 'px';
    el.style.top = cellY(newPositions[i].r) + 'px';
  });
  setTimeout(callback, 220);
}

// 需求4：弹性回弹效果 —— 先快速滑过原位，再弹回来
function bounceBack() {
  if (!dragging) return;
  dragging.chain.forEach((p, i) => {
    const el = brickEls[p.r + ',' + p.c];
    if (!el) return;
    // 使用 CSS cubic-bezier 做弹性效果
    el.style.transition = 'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.left = dragging.origPositions[i].x + 'px';
    el.style.top = dragging.origPositions[i].y + 'px';
  });
  setTimeout(() => render(), 450);
}

// ===== 消除动画 =====
function removePairAnimated(r1, c1, r2, c2) {
  drawConnectLine(r1, c1, r2, c2);
  const el1 = brickEls[r1 + ',' + c1];
  const el2 = brickEls[r2 + ',' + c2];
  if (el1) el1.classList.add('removing');
  if (el2) el2.classList.add('removing');

  setTimeout(() => {
    grid[r1][c1] = -1;
    grid[r2][c2] = -1;
    selected = null;
    candidates = [];
    hintPair = null;
    animating = false;
    render();
    setTimeout(checkGameEnd, 50);
  }, 320);
}

function drawConnectLine(r1, c1, r2, c2) {
  const line = document.createElement('div');
  line.className = 'connect-line';
  const x1 = cellX(c1) + BRICK / 2;
  const y1 = cellY(r1) + BRICK / 2;
  const x2 = cellX(c2) + BRICK / 2;
  const y2 = cellY(r2) + BRICK / 2;

  if (r1 === r2) {
    line.style.left = Math.min(x1, x2) + 'px';
    line.style.top = (y1 - 2) + 'px';
    line.style.width = Math.abs(x2 - x1) + 'px';
    line.style.height = '4px';
  } else {
    line.style.left = (x1 - 2) + 'px';
    line.style.top = Math.min(y1, y2) + 'px';
    line.style.width = '4px';
    line.style.height = Math.abs(y2 - y1) + 'px';
  }

  wrapper.appendChild(line);
  setTimeout(() => line.remove(), 300);
}

// ===== 查找可消除的一对（用于提示和游戏结束判断）=====
function findAnyRemovable() {
  const byType = {};
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] >= 0) {
        const t = grid[r][c];
        if (!byType[t]) byType[t] = [];
        byType[t].push({ r, c });
      }
    }
  }
  for (const t in byType) {
    const list = byType[t];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (canConnect(list[i].r, list[i].c, list[j].r, list[j].c)) {
          return [list[i], list[j]];
        }
      }
    }
  }
  return null;
}

function findSlidableRemovable() {
  const direct = findAnyRemovable();
  if (direct) return { type: 'direct', pair: direct };

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] < 0) continue;
      const brickType = grid[r][c];
      // 四个方向尝试滑动
      for (const [horiz, dir] of [[true, 1], [true, -1], [false, 1], [false, -1]]) {
        // 向移动方向找连续砖块（推动链）
        const chain = [{ r, c }];
        let nr = r + (horiz ? 0 : dir), nc = c + (horiz ? dir : 0);
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] >= 0) {
          chain.push({ r: nr, c: nc });
          nr += horiz ? 0 : dir;
          nc += horiz ? dir : 0;
        }
        // 计算最大步数
        let maxSteps = 0;
        let tr = nr, tc = nc;
        while (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS && grid[tr][tc] < 0) {
          maxSteps++;
          tr += horiz ? 0 : dir;
          tc += horiz ? dir : 0;
        }

        for (let steps = 1; steps <= maxSteps; steps++) {
          const backup = grid.map(row => [...row]);
          const types = chain.map(p => grid[p.r][p.c]);
          chain.forEach(p => { grid[p.r][p.c] = -1; });
          chain.forEach((p, i) => {
            const newR = p.r + (horiz ? 0 : dir * steps);
            const newC = p.c + (horiz ? dir * steps : 0);
            grid[newR][newC] = types[i];
          });
          // 只检查被拖拽的砖块（chain[0]）
          const movedR = r + (horiz ? 0 : dir * steps);
          const movedC = c + (horiz ? dir * steps : 0);
          const match = findMatchForBrick(movedR, movedC, brickType);
          for (let rr = 0; rr < ROWS; rr++) grid[rr] = backup[rr];
          if (match) return { type: 'slide', pair: match };
        }
      }
    }
  }
  return null;
}

// ===== 游戏结束检查 =====
function checkGameEnd() {
  let hasBricks = false;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] >= 0) { hasBricks = true; break; }

  if (!hasBricks) {
    showMsg('🎉 恭喜过关！');
    return;
  }
  if (!findSlidableRemovable()) {
    showMsg('😅 没有可消除的砖块了，游戏结束！');
  }
}

// ===== 提示功能 =====
document.getElementById('hint-btn').addEventListener('click', () => {
  if (animating) return;
  const result = findSlidableRemovable();
  if (result) {
    hintPair = result.pair;
    selected = null;
    candidates = [];
    render();
    setTimeout(() => { hintPair = null; render(); }, 3000);
  } else {
    showMsg('😅 没有可消除的砖块了！');
  }
});

// ===== 消息弹窗 =====
function showMsg(text) {
  document.getElementById('msg-text').textContent = text;
  const msg = document.getElementById('message');
  msg.style.display = 'block';
  msg.dataset.win = text.includes('过关') ? 'true' : 'false';
}
function closeMsg() {
  const msg = document.getElementById('message');
  msg.style.display = 'none';
  if (msg.dataset.win === 'true') { level++; initLevel(); }
}

// ===== 控制按钮 =====
function restartLevel() { initLevel(); }
function nextLevel() { customMode = false; level++; initLevel(); }
function prevLevel() { if (level > 1) { customMode = false; level--; initLevel(); } }

// ===== 定制关卡 =====
function openCustom() {
  document.getElementById('custom-types').value = customTypeCount;
  updateCustomPreview();
  document.getElementById('custom-modal').classList.add('open');
}
function closeCustom() {
  document.getElementById('custom-modal').classList.remove('open');
}
function updateCustomPreview() {
  const n = parseInt(document.getElementById('custom-types').value) || 10;
  const clamped = Math.max(2, Math.min(70, n));
  let preview = '';
  for (let i = 0; i < clamped; i++) preview += getIcon(i);
  document.getElementById('custom-preview').textContent = preview;
}
function startCustom() {
  const n = parseInt(document.getElementById('custom-types').value) || 10;
  customTypeCount = Math.max(2, Math.min(70, n));
  customMode = true;
  closeCustom();
  initLevel();
}

// 监听输入框变化实时预览
document.getElementById('custom-types')?.addEventListener('input', updateCustomPreview);

// ===== 图标禁用管理 =====

// 打开图标库弹窗
function openIconModal() {
  const grid = document.getElementById('icon-grid');
  grid.innerHTML = '';
  const total = ICONS.length + EXTRA_EMOJI.length; // 70个
  for (let i = 0; i < total; i++) {
    const item = document.createElement('div');
    item.className = 'icon-item ' + (disabledIcons.has(i) ? 'disabled' : 'active');
    item.textContent = getIcon(i);
    item.onclick = () => {
      if (disabledIcons.has(i)) {
        disabledIcons.delete(i);
        item.className = 'icon-item active';
      } else {
        disabledIcons.add(i);
        item.className = 'icon-item disabled';
      }
    };
    grid.appendChild(item);
  }
  document.getElementById('icon-modal').classList.add('open');
}
function closeIconModal() {
  document.getElementById('icon-modal').classList.remove('open');
}
document.getElementById('icon-lib-btn').addEventListener('click', openIconModal);

// 获取当前可用的图标索引列表
function getEnabledIcons(count) {
  const all = [];
  const total = ICONS.length + EXTRA_EMOJI.length;
  for (let i = 0; i < total; i++) {
    if (!disabledIcons.has(i)) all.push(i);
  }
  return all.slice(0, count);
}

// ===== AI 解题系统 =====
let aiSolution = [];   // 解题步骤 [{r1,c1,r2,c2,type,action}, ...]
let aiStepIdx = -1;
let aiGridSnapshots = []; // 每步之前的grid快照
let aiRunning = false;

// 每次打开AI面板时重置状态，确保切换关卡后重新解题
document.getElementById('ai-solve-btn').addEventListener('click', () => {
  aiSolution = [];
  aiStepIdx = -1;
  aiGridSnapshots = [];
  aiRunning = false;
  document.getElementById('ai-status').textContent = '点击「开始解题」观看AI自动通关';
  document.getElementById('ai-steps').innerHTML = '';
  document.getElementById('ai-board-mini').innerHTML = '';
  document.getElementById('ai-start-btn').disabled = false;
  document.getElementById('ai-prev-btn').disabled = true;
  document.getElementById('ai-next-btn').disabled = true;
  document.getElementById('ai-panel').classList.add('open');
});

function aiClose() {
  document.getElementById('ai-panel').classList.remove('open');
  aiRunning = false;
}

// AI求解：使用DFS+回溯找到一条通关路径
function aiSolve(g) {
  const clone = g.map(r => [...r]);
  const steps = [];
  const snapshots = [clone.map(r => [...r])];
  const startTime = Date.now();
  const TIME_LIMIT = 10000; // 10秒超时
  let solved = false;

  function solve(grid, depth) {
    if (solved) return true;
    if (Date.now() - startTime > TIME_LIMIT) return false;

    let hasBrick = false;
    for (let r = 0; r < ROWS && !hasBrick; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c] >= 0) { hasBrick = true; break; }
    if (!hasBrick) { solved = true; return true; }

    // 优先直接消除
    const pairs = findAllPairs(grid);
    for (const move of pairs) {
      const backup = grid.map(r => [...r]);
      grid[move.r1][move.c1] = -1;
      grid[move.r2][move.c2] = -1;
      steps.push({...move, action:'click'});
      snapshots.push(grid.map(r => [...r]));
      if (solve(grid, depth + 1)) return true;
      steps.pop(); snapshots.pop();
      for (let r = 0; r < ROWS; r++) grid[r] = backup[r];
    }

    // 再尝试滑动消除
    const slideMoves = findAllSlidePairs(grid);
    for (const move of slideMoves) {
      const backup = grid.map(r => [...r]);
      executeSlide(grid, move);
      grid[move.r1][move.c1] = -1;
      grid[move.r2][move.c2] = -1;
      steps.push(move);
      snapshots.push(grid.map(r => [...r]));
      if (solve(grid, depth + 1)) return true;
      steps.pop(); snapshots.pop();
      for (let r = 0; r < ROWS; r++) grid[r] = backup[r];
    }
    return false;
  }

  solve(clone, 0);
  return { steps, snapshots };
}

function findAllPairs(g) {
  const pairs = [];
  const byType = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (g[r][c] >= 0) {
        const t = g[r][c];
        if (!byType[t]) byType[t] = [];
        byType[t].push({r, c});
      }
  for (const t in byType) {
    const list = byType[t];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (canConnectG(g, list[i].r, list[i].c, list[j].r, list[j].c))
          pairs.push({r1:list[i].r, c1:list[i].c, r2:list[j].r, c2:list[j].c, type:parseInt(t)});
  }
  return pairs;
}

// 通用版canConnect，接受grid参数
function canConnectG(g, r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return false;
  if (r1 === r2) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo + 1; c < hi; c++) if (g[r1][c] >= 0) return false;
    return true;
  }
  if (c1 === c2) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) if (g[r][c1] >= 0) return false;
    return true;
  }
  return false;
}

function findAllSlidePairs(g) {
  const results = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (g[r][c] < 0) continue;
      const brickType = g[r][c];
      for (const [horiz, dir] of [[true,1],[true,-1],[false,1],[false,-1]]) {
        const chain = [{r,c}];
        let nr = r + (horiz?0:dir), nc = c + (horiz?dir:0);
        while (nr>=0 && nr<ROWS && nc>=0 && nc<COLS && g[nr][nc]>=0) {
          chain.push({r:nr,c:nc});
          nr += horiz?0:dir; nc += horiz?dir:0;
        }
        let maxSteps = 0;
        let tr=nr, tc=nc;
        while (tr>=0 && tr<ROWS && tc>=0 && tc<COLS && g[tr][tc]<0) {
          maxSteps++; tr += horiz?0:dir; tc += horiz?dir:0;
        }
        for (let steps = 1; steps <= maxSteps; steps++) {
          const backup = g.map(row=>[...row]);
          const types = chain.map(p=>g[p.r][p.c]);
          chain.forEach(p=>{g[p.r][p.c]=-1;});
          const newPos = chain.map((p,i)=>({
            r: p.r+(horiz?0:dir*steps), c: p.c+(horiz?dir*steps:0)
          }));
          newPos.forEach((p,i)=>{g[p.r][p.c]=types[i];});
          const movedR = r+(horiz?0:dir*steps), movedC = c+(horiz?dir*steps:0);
          // 找配对
          let found = false;
          for (let rr=0;rr<ROWS&&!found;rr++)
            for (let cc=0;cc<COLS&&!found;cc++) {
              if (rr===movedR&&cc===movedC) continue;
              if (g[rr][cc]===brickType && canConnectG(g,movedR,movedC,rr,cc)) {
                results.push({r1:movedR,c1:movedC,r2:rr,c2:cc,type:brickType,
                  action:'slide',origR:r,origC:c,horiz,dir,steps,chain:chain.map(p=>({...p}))});
                found = true;
              }
            }
          // 恢复grid
          for (let r2=0;r2<ROWS;r2++) g[r2]=backup[r2];
        }
      }
    }
  }
  return results;
}

function executeSlide(g, move) {
  const {chain, horiz, dir, steps} = move;
  const types = chain.map(p => g[p.r][p.c]);
  chain.forEach(p => { g[p.r][p.c] = -1; });
  chain.forEach((p, i) => {
    g[p.r + (horiz?0:dir*steps)][p.c + (horiz?dir*steps:0)] = types[i];
  });
}

// AI开始解题 — 需求2：从当前grid状态开始解题
function aiStart() {
  document.getElementById('ai-status').innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div><div>AI 正在计算解法…</div><div class="ai-progress-bar"><div class="ai-progress-fill" id="ai-progress-fill"></div></div><div class="ai-progress-text" id="ai-progress-text">0%</div></div>';
  document.getElementById('ai-start-btn').disabled = true;
  aiRunning = true;

  // 模拟进度动画
  let progress = 0;
  const progressTimer = setInterval(() => {
    progress = Math.min(progress + Math.random() * 8 + 2, 95);
    const fill = document.getElementById('ai-progress-fill');
    const text = document.getElementById('ai-progress-text');
    if (fill) fill.style.width = progress + '%';
    if (text) text.textContent = Math.round(progress) + '%';
  }, 200);

  setTimeout(() => {
    const result = aiSolve(grid);
    clearInterval(progressTimer);
    const fill = document.getElementById('ai-progress-fill');
    const text = document.getElementById('ai-progress-text');
    if (fill) fill.style.width = '100%';
    if (text) text.textContent = '100%';

    setTimeout(() => {
      if (result.steps.length === 0) {
        let hasBricks = false;
        for (let r = 0; r < ROWS && !hasBricks; r++)
          for (let c = 0; c < COLS; c++)
            if (grid[r][c] >= 0) { hasBricks = true; break; }
        if (!hasBricks) {
          document.getElementById('ai-status').textContent = '🎉 当前已经通关了！';
        } else {
          document.getElementById('ai-status').textContent = '💀 当前为死局，AI无法找到通关路径';
        }
        document.getElementById('ai-start-btn').disabled = false;
        aiRunning = false;
        return;
      }
      aiSolution = result.steps;
      aiGridSnapshots = result.snapshots;
      aiStepIdx = -1;
      document.getElementById('ai-status').textContent = `✅ 找到解法！共 ${aiSolution.length} 步`;
      renderAiSteps();
      aiAutoPlay();
    }, 300);
  }, 50);
}

function aiAutoPlay() {
  if (!aiRunning) return;
  if (aiStepIdx >= aiSolution.length - 1) {
    document.getElementById('ai-status').textContent = `🎉 AI通关完成！共 ${aiSolution.length} 步`;
    document.getElementById('ai-start-btn').disabled = false;
    document.getElementById('ai-prev-btn').disabled = false;
    document.getElementById('ai-next-btn').disabled = true;
    aiRunning = false;
    return;
  }
  aiStepIdx++;
  renderAiMiniBoard();
  renderAiSteps();
  setTimeout(() => aiAutoPlay(), 500);
}

function aiStepPrev() {
  if (aiStepIdx <= 0) return;
  aiStepIdx--;
  renderAiMiniBoard();
  renderAiSteps();
  document.getElementById('ai-next-btn').disabled = false;
  document.getElementById('ai-prev-btn').disabled = (aiStepIdx <= 0);
}

function aiStepNext() {
  if (aiStepIdx >= aiSolution.length - 1) return;
  aiStepIdx++;
  renderAiMiniBoard();
  renderAiSteps();
  document.getElementById('ai-prev-btn').disabled = false;
  document.getElementById('ai-next-btn').disabled = (aiStepIdx >= aiSolution.length - 1);
}

function renderAiSteps() {
  const container = document.getElementById('ai-steps');
  container.innerHTML = '';
  aiSolution.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-item' + (i === aiStepIdx ? ' current' : '');
    const icon = getIcon(step.type);
    const actionText = step.action === 'slide' ? '滑动消除' : '直接消除';
    div.textContent = `第${i+1}步: ${icon} (${step.r1},${step.c1})↔(${step.r2},${step.c2}) ${actionText}`;
    div.onclick = () => {
      aiStepIdx = i;
      renderAiMiniBoard();
      renderAiSteps();
      document.getElementById('ai-prev-btn').disabled = (i <= 0);
      document.getElementById('ai-next-btn').disabled = (i >= aiSolution.length - 1);
    };
    container.appendChild(div);
  });
  // 滚动到当前步
  const cur = container.querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function renderAiMiniBoard() {
  const mini = document.getElementById('ai-board-mini');
  mini.innerHTML = '';
  const scale = 0.45;
  const mCELL = Math.round(CELL * scale);
  const mGAP = 1;
  const mPAD = 2;
  const mBRICK = Math.round(BRICK * scale);
  const mSTEP = mCELL + mGAP;

  const w = mPAD*2 + COLS*mCELL + (COLS-1)*mGAP;
  const h = mPAD*2 + ROWS*mCELL + (ROWS-1)*mGAP;
  mini.style.width = w + 'px';
  mini.style.height = h + 'px';
  mini.style.position = 'relative';
  mini.style.background = '#0a0a1a';
  mini.style.borderRadius = '4px';

  // 使用当前步骤对应的快照
  const snap = aiStepIdx >= 0 ? aiGridSnapshots[aiStepIdx] : aiGridSnapshots[0];
  if (!snap) return;

  const step = aiStepIdx >= 0 ? aiSolution[aiStepIdx] : null;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // 底格
      const cell = document.createElement('div');
      cell.className = 'mini-cell';
      cell.style.cssText = `position:absolute;left:${mPAD+c*mSTEP}px;top:${mPAD+r*mSTEP}px;width:${mCELL}px;height:${mCELL}px;`;
      mini.appendChild(cell);

      if (snap[r][c] < 0) continue;
      const type = snap[r][c];
      const el = document.createElement('div');
      el.className = 'mini-brick';
      if (sliceMode && sliceImageMap[type]) {
        el.style.cssText = `left:${mPAD+c*mSTEP+1}px;top:${mPAD+r*mSTEP+1}px;width:${mBRICK}px;height:${mBRICK}px;overflow:hidden;`;
        const img = document.createElement('img');
        img.src = sliceImageMap[type];
        img.style.cssText = 'width:100%;height:100%;display:block;';
        el.appendChild(img);
      } else {
        el.style.cssText = `left:${mPAD+c*mSTEP+1}px;top:${mPAD+r*mSTEP+1}px;width:${mBRICK}px;height:${mBRICK}px;background:${getColor(type)};`;
        el.textContent = getIcon(type);
      }
      // 高亮当前步要消除的砖块
      if (step && ((step.r1===r&&step.c1===c)||(step.r2===r&&step.c2===c))) {
        el.style.boxShadow = '0 0 4px 2px #e94560';
        el.style.zIndex = '2';
      }
      mini.appendChild(el);
    }
  }
}

// ===== 图片识别系统 =====
// 需求3&4：上传14×10的砖块截图，识别相同砖块并转化为游戏布局
// 原理：将图片切成14行×10列的小格，对每个格子取中心区域的平均颜色，
// 颜色相近的格子视为同一种砖块，然后映射到游戏已有的图标上。

function openRecognize() {
  document.getElementById('recognize-modal').classList.add('open');
  document.getElementById('recognize-status').textContent = '请上传一张14×10的砖块游戏截图';
  document.getElementById('recognize-preview').innerHTML = '';
  document.getElementById('recognize-confirm').style.display = 'none';
  document.getElementById('recognize-file').value = '';
}
function closeRecognize() {
  document.getElementById('recognize-modal').classList.remove('open');
}

document.getElementById('recognize-btn').addEventListener('click', openRecognize);

// 上传图片后处理
document.getElementById('recognize-file').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    document.getElementById('recognize-status').textContent = '❌ 请上传图片文件';
    return;
  }
  document.getElementById('recognize-status').textContent = '🔍 正在识别图片...';

  const img = new Image();
  img.onload = () => {
    try {
      const result = recognizeGrid(img);
      if (!result) {
        document.getElementById('recognize-status').textContent = '❌ 识别失败：无法从图片中识别出有效的砖块布局';
        return;
      }
      // 显示预览
      recognizedGrid = result;
      showRecognizePreview(result);
      document.getElementById('recognize-status').textContent = `✅ 识别成功！发现 ${result.typeCount} 种砖块`;
      document.getElementById('recognize-confirm').style.display = 'flex';
    } catch (err) {
      document.getElementById('recognize-status').textContent = '❌ 识别出错：' + err.message;
    }
  };
  img.onerror = () => {
    document.getElementById('recognize-status').textContent = '❌ 图片加载失败';
  };
  img.src = URL.createObjectURL(file);
});

let recognizedGrid = null; // 暂存识别结果
let sliceImages = [];      // 切片图片 DataURL [row][col]

// 核心识别逻辑（切片法）：
// 1. 把图片按14行×10列切成140个小图片
// 2. 直接用切片作为砖块在游戏中显示
// 3. 比较两个切片的像素重合率，重合率高则判定为同一种砖块
function recognizeGrid(img) {
  // --- 将图片绘制到 canvas 上，获取像素数据 ---
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const fullData = ctx.getImageData(0, 0, img.width, img.height).data;
  const W = img.width, H = img.height;

  // --- 工具函数 ---
  function brightness(x, y) {
    const i = (y * W + x) * 4;
    return fullData[i] * 0.299 + fullData[i+1] * 0.587 + fullData[i+2] * 0.114;
  }

  // --- 第一步：找到网格的外边界（排除棕色木纹边框）---
  // 扫描每列/行的平均亮度，网格内部浅绿色背景亮度 > 170，棕色边框 < 150
  function colBright(x, y0, y1) {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y += 3) { s += brightness(x, y); n++; }
    return s / n;
  }
  function rowBright(y, x0, x1) {
    let s = 0, n = 0;
    for (let x = x0; x < x1; x += 3) { s += brightness(x, y); n++; }
    return s / n;
  }

  const TH = 160;
  let left = 0, right = W, top = 0, bottom = H;
  // 从左向右
  for (let x = 0; x < W * 0.3; x++) {
    if (colBright(x, Math.floor(H*0.3), Math.floor(H*0.7)) > TH) { left = x; break; }
  }
  // 从右向左
  for (let x = W - 1; x > W * 0.7; x--) {
    if (colBright(x, Math.floor(H*0.3), Math.floor(H*0.7)) > TH) { right = x + 1; break; }
  }
  // 从上向下
  for (let y = 0; y < H * 0.3; y++) {
    if (rowBright(y, Math.floor(W*0.3), Math.floor(W*0.7)) > TH) { top = y; break; }
  }
  // 从下向上：排除底部黄色边框，检测亮度突变点
  for (let y = H - 1; y > H * 0.7; y--) {
    const b = rowBright(y, Math.floor(W*0.3), Math.floor(W*0.7));
    if (b > TH) {
      // 继续向上找到亮度稳定的网格区域（跳过边框色带）
      // 检查该行的颜色是否偏黄/棕（边框特征：R>180, G>140, B<120）
      let rSum=0, gSum=0, bSum=0, n=0;
      for (let x = Math.floor(W*0.3); x < Math.floor(W*0.7); x += 3) {
        const i = (y * W + x) * 4;
        rSum += fullData[i]; gSum += fullData[i+1]; bSum += fullData[i+2]; n++;
      }
      const avgR = rSum/n, avgG = gSum/n, avgB = bSum/n;
      // 黄色/棕色边框：R高、G中、B低
      if (avgR > 160 && avgB < 130 && avgR - avgB > 40) continue;
      bottom = y + 1; break;
    }
  }

  // --- 第二步：在网格区域内，检测网格线的精确位置 ---
  // 网格线是砖块之间的细线（颜色比砖块背景暗）。
  // 沿水平方向扫描每一列的亮度，网格线处亮度会出现局部低谷。
  // 我们找到 COLS-1=9 条竖线和 ROWS-1=13 条横线，从而精确定位每个砖块。
  const gridW = right - left;
  const gridH = bottom - top;
  const approxCellW = gridW / COLS;
  const approxCellH = gridH / ROWS;

  // 找竖直网格线：在每两个砖块之间的预期位置附近搜索亮度最低点
  function findGridLines(count, totalLen, start, isVertical) {
    const approxCell = totalLen / count;
    const lines = []; // 每条线的像素位置
    for (let i = 1; i < count; i++) {
      const expected = start + i * approxCell;
      // 在预期位置 ±30% 格子宽度范围内搜索
      const searchR = Math.floor(approxCell * 0.3);
      let minB = 999, minPos = Math.round(expected);
      for (let p = Math.round(expected) - searchR; p <= Math.round(expected) + searchR; p++) {
        if (p < 0 || (isVertical ? p >= W : p >= H)) continue;
        // 取该线上多个采样点的平均亮度
        let s = 0, n = 0;
        if (isVertical) {
          // 竖线：沿 y 方向采样
          for (let y = top + Math.floor(gridH*0.2); y < top + Math.floor(gridH*0.8); y += Math.max(1, Math.floor(gridH/20))) {
            s += brightness(p, y); n++;
          }
        } else {
          // 横线：沿 x 方向采样
          for (let x = left + Math.floor(gridW*0.2); x < left + Math.floor(gridW*0.8); x += Math.max(1, Math.floor(gridW/20))) {
            s += brightness(x, p); n++;
          }
        }
        const avg = s / n;
        if (avg < minB) { minB = avg; minPos = p; }
      }
      lines.push(minPos);
    }
    return lines;
  }

  const vLines = findGridLines(COLS, gridW, left, true);   // 9 条竖线
  const hLines = findGridLines(ROWS, gridH, top, false);    // 13 条横线

  // 用网格线位置计算每个砖块的精确边界
  // 砖块 [r][c] 的范围：
  //   x: 从上一条竖线（或 left）到下一条竖线（或 right）
  //   y: 从上一条横线（或 top）到下一条横线（或 bottom）
  function cellBounds(r, c) {
    const x0 = c === 0 ? left : vLines[c-1];
    const x1 = c === COLS-1 ? right : vLines[c];
    const y0 = r === 0 ? top : hLines[r-1];
    const y1 = r === ROWS-1 ? bottom : hLines[r];
    return { x0, y0, x1, y1 };
  }

  // --- 第三步：切片 ---
  // 对每个砖块，取其边界内部区域（跳过网格线本身，内缩 8%）
  const SLICE_SIZE = 40; // 稍大的切片尺寸，保留更多细节用于比较
  const sliceCanvas2 = document.createElement('canvas');
  sliceCanvas2.width = SLICE_SIZE;
  sliceCanvas2.height = SLICE_SIZE;
  const sliceCtx = sliceCanvas2.getContext('2d');

  sliceImages = [];
  const slicePixels = [];
  const margin = 0.08; // 内缩 8%，只跳过网格线边缘

  for (let r = 0; r < ROWS; r++) {
    sliceImages[r] = [];
    slicePixels[r] = [];
    for (let c = 0; c < COLS; c++) {
      const b = cellBounds(r, c);
      const cw = b.x1 - b.x0;
      const ch = b.y1 - b.y0;
      const sx = b.x0 + cw * margin;
      const sy = b.y0 + ch * margin;
      const sw = cw * (1 - 2 * margin);
      const sh = ch * (1 - 2 * margin);

      sliceCtx.clearRect(0, 0, SLICE_SIZE, SLICE_SIZE);
      sliceCtx.drawImage(canvas, sx, sy, Math.max(1,sw), Math.max(1,sh), 0, 0, SLICE_SIZE, SLICE_SIZE);

      sliceImages[r][c] = sliceCanvas2.toDataURL('image/png');

      const data = sliceCtx.getImageData(0, 0, SLICE_SIZE, SLICE_SIZE).data;
      const px = new Uint8Array(SLICE_SIZE * SLICE_SIZE * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        px[j] = data[i]; px[j+1] = data[i+1]; px[j+2] = data[i+2];
      }
      slicePixels[r][c] = px;
    }
  }

  // --- 第四步：比较切片相似度（MAE）---
  const N = ROWS * COLS;
  function sliceMAE(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  const distMatrix = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const r1 = Math.floor(i/COLS), c1 = i%COLS;
    for (let j = i+1; j < N; j++) {
      const r2 = Math.floor(j/COLS), c2 = j%COLS;
      const d = sliceMAE(slicePixels[r1][c1], slicePixels[r2][c2]);
      distMatrix[i*N+j] = d;
      distMatrix[j*N+i] = d;
    }
  }

  // --- 第五步：自适应阈值 + Union-Find 聚类 ---
  const allDists = [];
  for (let i = 0; i < N; i++)
    for (let j = i+1; j < N; j++)
      allDists.push(distMatrix[i*N+j]);
  allDists.sort((a,b) => a-b);

  let bestGap = 0, bestThreshold = 12;
  const searchEnd = Math.min(Math.floor(allDists.length * 0.3), allDists.length - 1);
  for (let i = 1; i < searchEnd; i++) {
    const gap = allDists[i] - allDists[i-1];
    if (gap > bestGap) { bestGap = gap; bestThreshold = (allDists[i]+allDists[i-1])/2; }
  }
  bestThreshold = Math.max(4, Math.min(20, bestThreshold));

  const parent = Array.from({length:N}, (_,i) => i);
  function find(x) { return parent[x]===x ? x : (parent[x]=find(parent[x])); }
  function union(a,b) { parent[find(a)] = find(b); }

  for (let i = 0; i < N; i++)
    for (let j = i+1; j < N; j++)
      if (distMatrix[i*N+j] < bestThreshold) union(i,j);

  // 二次验证：对每个聚类选代表切片，用代表切片重新比较
  // 先收集每个聚类的成员
  const clusters = {};
  for (let i = 0; i < N; i++) {
    const root = find(i);
    if (!clusters[root]) clusters[root] = [];
    clusters[root].push(i);
  }
  // 每个聚类选第一个成员作为代表
  const clusterReps = {};
  for (const root in clusters) clusterReps[root] = clusters[root][0];

  // 用代表切片之间的距离合并过于相似的聚类
  const roots = Object.keys(clusters).map(Number);
  for (let i = 0; i < roots.length; i++)
    for (let j = i+1; j < roots.length; j++) {
      const repI = clusterReps[roots[i]], repJ = clusterReps[roots[j]];
      if (distMatrix[repI*N+repJ] < bestThreshold * 0.8) {
        union(roots[i], roots[j]);
      }
    }

  const rootToType = {};
  let nextType = 0;
  const gridResult = [];
  for (let r = 0; r < ROWS; r++) {
    gridResult[r] = [];
    for (let c = 0; c < COLS; c++) {
      const root = find(r*COLS+c);
      if (!(root in rootToType)) rootToType[root] = nextType++;
      gridResult[r][c] = rootToType[root];
    }
  }

  // --- 第六步：强制偶数修正 ---
  // 反复修正直到所有类型都是偶数
  let maxIter = 50;
  while (maxIter-- > 0) {
    const typeCounts = {};
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = gridResult[r][c];
        typeCounts[t] = (typeCounts[t]||0) + 1;
      }
    // 找出所有奇数类型
    const oddTypes = Object.keys(typeCounts).filter(t => typeCounts[t] % 2 !== 0).map(Number);
    if (oddTypes.length === 0) break;

    // 两两配对：把一个奇数类型的某个砖块改成另一个奇数类型
    if (oddTypes.length >= 2) {
      const tA = oddTypes[0], tB = oddTypes[1];
      // 找 tA 中与 tB 最相似的砖块，改成 tB
      let bestCell = null, bestD = Infinity;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          if (gridResult[r][c] !== tA) continue;
          // 找这个砖块与 tB 类型中任意砖块的最小距离
          for (let r2 = 0; r2 < ROWS; r2++)
            for (let c2 = 0; c2 < COLS; c2++) {
              if (gridResult[r2][c2] !== tB) continue;
              const d = distMatrix[(r*COLS+c)*N + r2*COLS+c2];
              if (d < bestD) { bestD = d; bestCell = {r,c}; }
            }
        }
      if (bestCell) gridResult[bestCell.r][bestCell.c] = tB;
    } else {
      // 只剩1个奇数类型，找最相似的偶数类型合并
      const tA = oddTypes[0];
      let bestCell = null, bestTarget = -1, bestD = Infinity;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          if (gridResult[r][c] !== tA) continue;
          for (let r2 = 0; r2 < ROWS; r2++)
            for (let c2 = 0; c2 < COLS; c2++) {
              const t2 = gridResult[r2][c2];
              if (t2 === tA) continue;
              const d = distMatrix[(r*COLS+c)*N + r2*COLS+c2];
              if (d < bestD) { bestD = d; bestCell = {r,c}; bestTarget = t2; }
            }
        }
      if (bestCell && bestTarget >= 0) gridResult[bestCell.r][bestCell.c] = bestTarget;
    }
  }

  const finalTypes = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) finalTypes.add(gridResult[r][c]);

  if (finalTypes.size < 2 || finalTypes.size > 70) return null;

  const typeRepSlice = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = gridResult[r][c];
      if (!(t in typeRepSlice)) typeRepSlice[t] = {r, c};
    }

  return { grid: gridResult, typeCount: finalTypes.size, typeRepSlice };
}

// 预览识别结果（使用切片图片显示）
function showRecognizePreview(result) {
  const container = document.getElementById('recognize-preview');
  container.innerHTML = '';
  const scale = 0.5;
  const mCELL = Math.round(CELL * scale);
  const mGAP = 1;
  const mPAD = 2;
  const mBRICK = Math.round(BRICK * scale);
  const mSTEP = mCELL + mGAP;
  const w = mPAD*2 + COLS*mCELL + (COLS-1)*mGAP;
  const h = mPAD*2 + ROWS*mCELL + (ROWS-1)*mGAP;
  container.style.cssText = `width:${w}px;height:${h}px;position:relative;background:#0a0a1a;border-radius:4px;margin:8px auto;`;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${mPAD+c*mSTEP+1}px;top:${mPAD+r*mSTEP+1}px;width:${mBRICK}px;height:${mBRICK}px;border-radius:3px;overflow:hidden;`;
      const img = document.createElement('img');
      img.src = sliceImages[r][c];
      img.style.cssText = 'width:100%;height:100%;display:block;';
      el.appendChild(img);
      container.appendChild(el);
    }
  }
}

// 确认转化：将识别结果应用到游戏主界面

function confirmRecognize() {
  if (!recognizedGrid) return;
  for (let r = 0; r < ROWS; r++) {
    grid[r] = [...recognizedGrid.grid[r]];
  }
  // 构建 type → 代表切片图 的映射
  sliceMode = true;
  sliceImageMap = {};
  const rep = recognizedGrid.typeRepSlice;
  for (const t in rep) {
    sliceImageMap[t] = sliceImages[rep[t].r][rep[t].c];
  }
  customMode = true;
  customTypeCount = recognizedGrid.typeCount;
  levelEl.textContent = '识别';
  diffEl.textContent = recognizedGrid.typeCount + '种砖块';
  selected = null;
  candidates = [];
  hintPair = null;
  animating = false;
  closeRecognize();
  render();
}

// ===== 窗口自适应 =====
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(), 150);
});

// ===== 启动游戏 =====
calcSizes();
initLevel();
