# Sokoban Solver

[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/chipuystar/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/chipuystar/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

Entry for the [make.fun bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121) "Build the best Sokoban solver, 21 November 2026": one Node 22 program (`main.ts`) that answers all 5 Sokoban instances of a set in a single run, minimizing pushes.

## How it works

Every level is a one-cell-wide hallway with one to four rooms off it (3-4 boxes each), and boxes never leave their room in an optimal solution — so the solver splits the level into rooms and solves each room independently:

1. **Room detection.** Each room joins the level through a single door cell. Removing a door disconnects its room from the rest, so rooms are found by testing every floor cell as a possible door (a split-off part with 3-4 boxes, as many goals, inside a 6x6 box). The door cell itself belongs to the room and may start with a box on it.
2. **Push-optimal A\* per room.** Search over push states (sorted box positions + canonical player region), guided by an admissible min-cost box-goal matching heuristic over BFS distances, with static dead-square pruning from reverse pull-reachability. The first solution found is push-optimal for that room; a solution is only accepted when the player can still walk back out through the door.
3. **Stitching.** Rooms are solved in door order; the player walks between rooms through the hallway (BFS), and every push is expanded into the walk to the pushing position plus the push itself. The full move string is replayed on the original level before it is written out, so an illegal or incomplete answer is never emitted.

## Determinism

The program never reads the clock or randomness. Search budgets are counted in expanded nodes, heap ties break by insertion order, and every iteration order is fixed — two runs on the same set produce byte-identical outputs. The only environment reads are `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR`, which locate the input and output directories and never vary the computation.

## Practice results

| Instance | Boxes | Pushes | Optimal (P\*) | Points |
|----------|-------|--------|---------------|--------|
| i001 | 3 | 13 | 13 | 1,000 |
| i002 | 4 | 16 | 16 | 1,000 |
| i003 | 8 | 29 | 29 | 1,000 |
| i004 | 12 | 47 | 47 | 1,000 |
| i005 | 16 | 60 | 60 | 1,000 |

Total practice score: **1,000,000 / 1,000,000**, in about half a second for the whole set (limit: 60 seconds), verified deterministic across repeated runs.

## Running it

The program answers a whole set in one run. It reads `/input/<id>/level.txt`
for every instance id and writes `/output/<id>/solution.txt` (creating the
directories itself). Outside the grading container, the directories can be
redirected with `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`:

    mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

Node 22 or newer, no dependencies, no install step. If a level cannot be
solved, its `solution.txt` is still written (empty), so the entry always
answers every instance.

## Contents

- `main.ts` — the solver (room detection, push-optimal A\*, stitching).
- `package.json` — marks the entry as an ES module.
- `README.md` — this file.
- `LICENSE` — MIT.

## License

MIT. See [LICENSE](LICENSE).
