// Sokoban solver for make.fun sokoban-solver-01-run-20261121.
//
// Strategy: split each level into its rooms (one door each), solve every
// room push-optimally with A* over push states, then stitch the room
// solutions together with hallway walks. Fully deterministic: fixed
// iteration orders and work-count budgets only -- no clock, no randomness.
// The input/output directories come from MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR when the harness sets them (the process driver), else
// /input and /output (the container mounts); they only locate the files,
// never vary the computation.

import fs from "node:fs";
import path from "node:path";

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];
const CH = "udlr";

const OPTIMAL_BUDGET = 200000; // max A* expansions per room, optimal pass
const WEIGHTED_BUDGET = 100000; // max A* expansions per room, fallback pass
const GLOBAL_BUDGET = 800000; // max expansions across the whole run

// ---------- grid helpers ----------

function buildNeighbors(w, h) {
  const nb = new Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const idx = r * w + c;
      const row = [-1, -1, -1, -1];
      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d];
        const nc = c + DC[d];
        if (nr >= 0 && nr < h && nc >= 0 && nc < w) row[d] = nr * w + nc;
      }
      nb[idx] = row;
    }
  }
  return nb;
}

// Breadth-first shortest walk from `from` to `to` avoiding blocked cells.
// Returns an array of move chars, [] when from === to, null when unreachable.
function bfsPath(from, to, blocked, nb) {
  if (from === to) return [];
  if (blocked[to]) return null;
  const n = blocked.length;
  const prev = new Int32Array(n).fill(-2);
  const prevDir = new Int8Array(n).fill(-1);
  const q = [from];
  prev[from] = -1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const nbs = nb[cur];
    for (let d = 0; d < 4; d++) {
      const nx = nbs[d];
      if (nx < 0 || blocked[nx] || prev[nx] !== -2) continue;
      prev[nx] = cur;
      prevDir[nx] = d;
      if (nx === to) {
        const moves = [];
        let x = nx;
        while (prev[x] !== -1) {
          moves.push(CH[prevDir[x]]);
          x = prev[x];
        }
        moves.reverse();
        return moves;
      }
      q.push(nx);
    }
  }
  return null;
}

// All cells reachable from `from` avoiding blocked cells, as a byte mask.
function reachableMask(from, blocked, nb) {
  const n = blocked.length;
  const seen = new Uint8Array(n);
  const q = [from];
  seen[from] = 1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const nbs = nb[cur];
    for (let d = 0; d < 4; d++) {
      const nx = nbs[d];
      if (nx < 0 || blocked[nx] || seen[nx]) continue;
      seen[nx] = 1;
      q.push(nx);
    }
  }
  return seen;
}

// ---------- level parsing ----------

function parseLevel(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const h = lines.length;
  let w = 0;
  for (const l of lines) if (l.length > w) w = l.length;
  const walls = new Set();
  const goals = new Set();
  const boxes = [];
  let player = -1;
  for (let r = 0; r < h; r++) {
    const line = lines[r];
    for (let c = 0; c < w; c++) {
      const ch = c < line.length ? line[c] : "#";
      const idx = r * w + c;
      if (ch === "#") walls.add(idx);
      else if (ch === ".") goals.add(idx);
      else if (ch === "$") boxes.push(idx);
      else if (ch === "*") {
        goals.add(idx);
        boxes.push(idx);
      } else if (ch === "@") player = idx;
      else if (ch === "+") {
        goals.add(idx);
        player = idx;
      }
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, walls, goals, boxes, player, nb: buildNeighbors(w, h) };
}

// ---------- room detection ----------
// A room is a set of floor cells joined to the rest of the level through a
// single door cell. For every floor cell v, removing v splits the floor
// graph; a split-off part with 3-4 boxes, as many goals, inside a 6x6 box
// and away from the player start is a room. The door cell itself belongs
// to the room and may hold a box.

function detectRooms(level) {
  const { w, h, walls, goals, boxes, player, nb } = level;
  const n = w * h;
  const floor = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!walls.has(i)) floor[i] = 1;
  const boxSet = new Set(boxes);
  const candidates = [];
  for (let v = 0; v < n; v++) {
    if (!floor[v] || v === player) continue;
    const seen = new Uint8Array(n);
    seen[v] = 1;
    for (let s = 0; s < n; s++) {
      if (!floor[s] || seen[s]) continue;
      const cells = [];
      const q = [s];
      seen[s] = 1;
      let head = 0;
      let hasPlayer = false;
      let nBoxes = 0;
      let nGoals = 0;
      let minR = h;
      let maxR = -1;
      let minC = w;
      let maxC = -1;
      while (head < q.length) {
        const cur = q[head++];
        cells.push(cur);
        const r = (cur / w) | 0;
        const c = cur % w;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (cur === player) hasPlayer = true;
        if (boxSet.has(cur)) nBoxes++;
        if (goals.has(cur)) nGoals++;
        const nbs = nb[cur];
        for (let d = 0; d < 4; d++) {
          const nx = nbs[d];
          if (nx < 0 || !floor[nx] || seen[nx]) continue;
          seen[nx] = 1;
          q.push(nx);
        }
      }
      // The door cell itself belongs to the room too.
      if (boxSet.has(v)) nBoxes++;
      if (goals.has(v)) nGoals++;
      if (
        !hasPlayer &&
        nBoxes >= 3 &&
        nBoxes <= 4 &&
        nBoxes === nGoals &&
        maxR - minR + 1 <= 6 &&
        maxC - minC + 1 <= 6
      ) {
        candidates.push({ door: v, cells });
      }
    }
  }
  // Largest first: a true room is bigger than any strict part of it, so
  // greedy disjoint selection keeps the true rooms and drops false splits.
  candidates.sort((a, b) => b.cells.length - a.cells.length || a.door - b.door);
  const used = new Uint8Array(n);
  const rooms = [];
  for (const cand of candidates) {
    if (used[cand.door]) continue;
    let overlap = false;
    for (const c of cand.cells) {
      if (used[c]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (const c of cand.cells) used[c] = 1;
    used[cand.door] = 1;
    rooms.push(cand);
  }
  const covered = new Set();
  for (const room of rooms) {
    for (const c of room.cells) if (boxSet.has(c)) covered.add(c);
    if (boxSet.has(room.door)) covered.add(room.door);
  }
  if (covered.size !== boxes.length) return null;
  if (rooms.length < 1 || rooms.length > 4) return null;
  rooms.sort((a, b) => a.door - b.door);
  return rooms;
}

// ---------- room model ----------

function buildRoom(level, cand) {
  const { w, h, walls, goals, boxes, nb } = level;
  const n = w * h;
  const roomSet = new Set(cand.cells);
  roomSet.add(cand.door);
  const floor = new Uint8Array(n);
  for (const c of roomSet) floor[c] = 1;
  // Entry cells: hallway floor next to the door. The player walks through
  // them; boxes are never allowed onto them.
  const entry = new Uint8Array(n);
  const doorNbs = nb[cand.door];
  for (let d = 0; d < 4; d++) {
    const nx = doorNbs[d];
    if (nx >= 0 && !walls.has(nx) && !roomSet.has(nx)) {
      entry[nx] = 1;
      floor[nx] = 1;
    }
  }
  const roomBoxes = boxes.filter((b) => roomSet.has(b)).sort((a, b) => a - b);
  const roomGoals = [];
  for (const g of goals) if (roomSet.has(g)) roomGoals.push(g);
  roomGoals.sort((a, b) => a - b);
  let startPlayer = -1;
  for (let i = 0; i < n; i++) {
    if (entry[i]) {
      startPlayer = i;
      break;
    }
  }
  if (startPlayer < 0) startPlayer = cand.door;

  // Dead squares: cells a box can never leave towards a goal. Computed by
  // reverse pull-reachability from the goals, ignoring other boxes and
  // player reachability, so the live set is a superset of the truly live
  // cells and every pruned cell is genuinely dead.
  const isNode = new Uint8Array(n); // cells a box may occupy
  for (let i = 0; i < n; i++) if (floor[i] && !entry[i]) isNode[i] = 1;
  const live = new Uint8Array(n);
  const lq = [];
  for (const g of roomGoals) {
    live[g] = 1;
    lq.push(g);
  }
  let lh = 0;
  while (lh < lq.length) {
    const y = lq[lh++];
    const yr = (y / w) | 0;
    const yc = y % w;
    const nbs = nb[y];
    for (let d = 0; d < 4; d++) {
      const x = nbs[d];
      if (x < 0 || !isNode[x] || live[x]) continue;
      // A box moves x -> y only when the player can stand beyond x.
      const xr = (x / w) | 0;
      const xc = x % w;
      const pr = 2 * xr - yr;
      const pc = 2 * xc - yc;
      if (pr < 0 || pr >= h || pc < 0 || pc >= w) continue;
      if (!floor[pr * w + pc]) continue;
      live[x] = 1;
      lq.push(x);
    }
  }
  const dead = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isNode[i] && !live[i]) dead[i] = 1;

  // BFS distances from each goal over the box-movement graph, for the
  // matching heuristic.
  const distFromGoal = roomGoals.map((g) => {
    const dist = new Int32Array(n).fill(-1);
    const q = [g];
    dist[g] = 0;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const nbs = nb[cur];
      for (let d = 0; d < 4; d++) {
        const nx = nbs[d];
        if (nx < 0 || !isNode[nx] || dist[nx] !== -1) continue;
        dist[nx] = dist[cur] + 1;
        q.push(nx);
      }
    }
    return dist;
  });

  // All permutations of goal indexes, for min-cost box-goal matching.
  const perms = [];
  const base = roomGoals.map((_, i) => i);
  (function permute(arr, k) {
    if (k === arr.length) {
      perms.push(arr.slice());
      return;
    }
    for (let i = k; i < arr.length; i++) {
      const t = arr[k];
      arr[k] = arr[i];
      arr[i] = t;
      permute(arr, k + 1);
      const t2 = arr[k];
      arr[k] = arr[i];
      arr[i] = t2;
    }
  })(base, 0);

  const notFloor = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!floor[i]) notFloor[i] = 1;

  return {
    w,
    h,
    nb,
    floor,
    entry,
    notFloor,
    boxes: roomBoxes,
    goals: roomGoals,
    goalSet: new Set(roomGoals),
    startPlayer,
    dead,
    distFromGoal,
    perms,
  };
}

// ---------- binary heap (min-heap by f, then h, then insertion order) ----------

function heapCmp(a, b) {
  if (a.f !== b.f) return a.f - b.f;
  if (a.h !== b.h) return a.h - b.h;
  return a.seq - b.seq;
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapCmp(heap[i], heap[p]) < 0) {
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    } else break;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < heap.length && heapCmp(heap[l], heap[m]) < 0) m = l;
      if (r < heap.length && heapCmp(heap[r], heap[m]) < 0) m = r;
      if (m === i) break;
      const t = heap[i];
      heap[i] = heap[m];
      heap[m] = t;
      i = m;
    }
  }
  return top;
}

// ---------- room solver: A* over pushes ----------

// Admissible heuristic: min-cost matching of boxes to goals over BFS
// distances (each push moves one box one cell, so the matched sum can drop
// by at most one per push). Infinity when a box sits on a dead square or
// cannot reach any goal.
function roomHeuristic(room, boxes) {
  for (const b of boxes) {
    if (room.dead[b] && !room.goalSet.has(b)) return Infinity;
  }
  let best = Infinity;
  for (const perm of room.perms) {
    let sum = 0;
    let ok = true;
    for (let i = 0; i < boxes.length; i++) {
      const d = room.distFromGoal[perm[i]][boxes[i]];
      if (d < 0) {
        ok = false;
        break;
      }
      sum += d;
    }
    if (ok && sum < best) best = sum;
  }
  return best;
}

function stateKey(boxes, player) {
  return boxes.join(",") + "|" + player;
}

function reconstruct(parent, key) {
  const pushes = [];
  let k = key;
  while (parent.has(k)) {
    const step = parent.get(k);
    pushes.push(step.push);
    k = step.pk;
  }
  pushes.reverse();
  return pushes;
}

function solveRoom(room, weight, maxExpansions, budget, requireExit) {
  const { w, h, nb } = room;
  const n = w * h;
  const h0 = roomHeuristic(room, room.boxes);
  if (h0 === Infinity) return null;

  const blocked0 = room.notFloor.slice();
  for (const b of room.boxes) blocked0[b] = 1;
  const reach0 = reachableMask(room.startPlayer, blocked0, nb);
  let canon0 = -1;
  for (let i = 0; i < n; i++) {
    if (reach0[i]) {
      canon0 = i;
      break;
    }
  }

  const startKey = stateKey(room.boxes, canon0);
  const best = new Map();
  best.set(startKey, 0);
  const parent = new Map(); // key -> { pk, push }
  // Heap entries stay light (key + player only); the box list is decoded
  // from the key when popped, so a huge search cannot blow the 512 MB cap
  // on duplicate box arrays.
  const heap = [];
  let seq = 0;
  heapPush(heap, { f: weight * h0, h: h0, seq: seq++, key: startKey, g: 0, player: canon0 });
  let expansions = 0;

  while (heap.length > 0) {
    const cur = heapPop(heap);
    if (best.get(cur.key) !== cur.g) continue; // stale entry
    if (expansions >= maxExpansions || budget.used >= budget.limit) return null;
    expansions++;
    budget.used++;
    const boxes = cur.key.split("|")[0].split(",").map(Number);

    // Goal test: every box on a goal, and (when required) the player able
    // to walk back out through an entry cell.
    let solved = true;
    for (const b of boxes) {
      if (!room.goalSet.has(b)) {
        solved = false;
        break;
      }
    }
    if (solved) {
      if (!requireExit) {
        return { pushes: reconstruct(parent, cur.key), expansions };
      }
      const blocked = room.notFloor.slice();
      for (const b of boxes) blocked[b] = 1;
      const reach = reachableMask(cur.player, blocked, nb);
      let canExit = false;
      for (let i = 0; i < n; i++) {
        if (room.entry[i] && reach[i]) {
          canExit = true;
          break;
        }
      }
      if (canExit) return { pushes: reconstruct(parent, cur.key), expansions };
      continue; // solved but trapped: never expand (any continuation costs pushes)
    }

    const blocked = room.notFloor.slice();
    const boxSet = new Set(boxes);
    for (const b of boxes) blocked[b] = 1;
    const reach = reachableMask(cur.player, blocked, nb);

    for (const b of boxes) {
      const nbs = nb[b];
      for (let d = 0; d < 4; d++) {
        const to = nbs[d];
        if (to < 0 || !room.floor[to] || room.entry[to] || boxSet.has(to)) continue;
        const from = nbs[d ^ 1];
        if (from < 0 || !room.floor[from] || !reach[from]) continue;
        const newBoxes = [];
        for (const x of boxes) newBoxes.push(x === b ? to : x);
        newBoxes.sort((x, y) => x - y);
        const hh = roomHeuristic(room, newBoxes);
        if (hh === Infinity) continue;
        const g2 = cur.g + 1;
        // Canonical player: smallest cell of the region the player ends in.
        const blocked2 = room.notFloor.slice();
        for (const x of newBoxes) blocked2[x] = 1;
        const reach2 = reachableMask(b, blocked2, nb);
        let canon = -1;
        for (let i = 0; i < n; i++) {
          if (reach2[i]) {
            canon = i;
            break;
          }
        }
        const key = stateKey(newBoxes, canon);
        const prev = best.get(key);
        if (prev !== undefined && prev <= g2) continue;
        best.set(key, g2);
        parent.set(key, { pk: cur.key, push: { from: b, to, dir: d } });
        heapPush(heap, { f: g2 + weight * hh, h: hh, seq: seq++, key, g: g2, player: canon });
      }
    }
  }
  return null;
}

// ---------- stitching rooms together ----------

function buildRoomMoves(room, pushes, startPlayer) {
  const { nb } = room;
  const n = room.w * room.h;
  const boxes = new Set(room.boxes);
  let player = startPlayer;
  const moves = [];
  for (const p of pushes) {
    const stand = nb[p.from][p.dir ^ 1];
    const blocked = room.notFloor.slice();
    for (const b of boxes) blocked[b] = 1;
    const walk = bfsPath(player, stand, blocked, nb);
    if (!walk) return null;
    for (const m of walk) moves.push(m);
    moves.push(CH[p.dir]);
    boxes.delete(p.from);
    boxes.add(p.to);
    player = p.from;
  }
  const blocked = room.notFloor.slice();
  for (const b of boxes) blocked[b] = 1;
  const reach = reachableMask(player, blocked, nb);
  let exit = -1;
  for (let i = 0; i < n; i++) {
    if (room.entry[i] && reach[i]) {
      exit = i;
      break;
    }
  }
  if (exit < 0) return null;
  const walk = bfsPath(player, exit, blocked, nb);
  if (!walk) return null;
  for (const m of walk) moves.push(m);
  return { moves, endPlayer: exit };
}

function solveInstance(level, budget) {
  const { w, h, walls, nb } = level;
  const n = w * h;
  const rooms = detectRooms(level);
  if (!rooms) return null;
  const boxSet = new Set(level.boxes);
  let player = level.player;
  const allMoves = [];
  for (const cand of rooms) {
    const room = buildRoom(level, cand);
    // Walk through the hallway to this room's entry cell.
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (walls.has(i)) blocked[i] = 1;
    for (const b of boxSet) blocked[b] = 1;
    const walk = bfsPath(player, room.startPlayer, blocked, nb);
    if (!walk) return null;
    for (const m of walk) allMoves.push(m);
    player = room.startPlayer;

    let result = solveRoom(room, 1, OPTIMAL_BUDGET, budget, false);
    let roomMoves = result ? buildRoomMoves(room, result.pushes, player) : null;
    if (!roomMoves) {
      // Either no optimal solution, or the optimal one traps the player:
      // retry requiring an exit, then fall back to a weighted search.
      result = solveRoom(room, 1, OPTIMAL_BUDGET, budget, true);
      roomMoves = result ? buildRoomMoves(room, result.pushes, player) : null;
    }
    if (!roomMoves) {
      result = solveRoom(room, 3, WEIGHTED_BUDGET, budget, true);
      roomMoves = result ? buildRoomMoves(room, result.pushes, player) : null;
    }
    if (!roomMoves) return null;
    for (const m of roomMoves.moves) allMoves.push(m);
    player = roomMoves.endPlayer;
    for (const b of room.boxes) boxSet.delete(b);
    for (const g of room.goals) boxSet.add(g);
  }
  if (!validate(level, allMoves)) return null;
  return allMoves.join("");
}

function validate(level, moves) {
  const boxes = new Set(level.boxes);
  let player = level.player;
  for (const ch of moves) {
    const d = CH.indexOf(ch);
    if (d < 0) return false;
    const nx = level.nb[player][d];
    if (nx < 0 || level.walls.has(nx)) return false;
    if (boxes.has(nx)) {
      const t = level.nb[nx][d];
      if (t < 0 || level.walls.has(t) || boxes.has(t)) return false;
      boxes.delete(nx);
      boxes.add(t);
    }
    player = nx;
  }
  for (const b of boxes) if (!level.goals.has(b)) return false;
  return true;
}

// ---------- entry point ----------

function countPushes(level, moves) {
  const boxes = new Set(level.boxes);
  let player = level.player;
  let pushes = 0;
  for (const ch of moves) {
    const d = CH.indexOf(ch);
    const nx = level.nb[player][d];
    if (boxes.has(nx)) {
      pushes++;
      const t = level.nb[nx][d];
      boxes.delete(nx);
      boxes.add(t);
    }
    player = nx;
  }
  return pushes;
}

function main() {
  const budget = { used: 0, limit: GLOBAL_BUDGET };
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  let ids;
  try {
    ids = fs.readdirSync(inputDir).sort();
  } catch {
    return;
  }
  for (const id of ids) {
    const levelPath = path.join(inputDir, id, "level.txt");
    let text;
    try {
      text = fs.readFileSync(levelPath, "utf8");
    } catch {
      continue; // not an instance directory
    }
    let solution = "";
    try {
      const level = parseLevel(text);
      const solved = solveInstance(level, budget);
      if (solved !== null) {
        solution = solved;
        console.error(id + ": solved, " + solved.length + " moves, " + countPushes(level, solved) + " pushes");
      } else {
        console.error(id + ": unsolved (empty answer)");
      }
    } catch (e) {
      console.error(id + ": error: " + (e && e.message ? e.message : e));
    }
    const outDir = path.join(outputDir, id);
    fs.mkdirSync(outDir, { recursive: true });
    if (Buffer.byteLength(solution, "utf8") > 65536) solution = "";
    fs.writeFileSync(path.join(outDir, "solution.txt"), solution, "utf8");
  }
  console.error("done, expansions used: " + budget.used);
}

main();
