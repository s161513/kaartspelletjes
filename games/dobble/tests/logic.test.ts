import { test } from "node:test";
import assert from "node:assert/strict";
import dobble from "../logic.js";
import { DECK } from "../deck.js";
import { SYMBOLS } from "../symbols.js";
import ticTacToe from "../../tictactoe/logic.js";
import { RoomManager } from "../../../server/src/rooms.js";
import type { DobbleState, DobbleMove } from "../types.js";

function match(state: DobbleState, id = "a"): DobbleMove {
  return { type:"symbolClick", roundId:state.round.id, symbolId:state.round.hands[id].find(s => state.round.center.includes(s))! };
}
test("57 cards, 8 distinct symbols each, all 1,596 intersections and symbol assets", () => {
  assert.equal(DECK.length,57); assert.equal(SYMBOLS.length,57);
  assert.equal(new Set(SYMBOLS.map(s=>s[0])).size,57);
  for (const card of DECK) { assert.equal(card.length,8); assert.equal(new Set(card).size,8); }
  let pairs=0;
  for(let i=0;i<57;i++)for(let j=i+1;j<57;j++) {assert.equal(DECK[i].filter(s=>DECK[j].includes(s)).length,1);pairs++;}
  assert.equal(pairs,1596);
});
test("2–8 players, distinct private hands and no private metadata on the wire",()=>{
  assert.throws(()=>dobble.init(["a"])); assert.throws(()=>dobble.init(Array.from({length:9},(_,i)=>String(i))));
  const state=dobble.init(Array.from({length:8},(_,i)=>String(i)));
  const views=state.playerIds.map(id=>dobble.playerView!(state,id)) as import("../types.js").DobbleView[];
  assert.equal(new Set(views.map(v=>[...v.round.own].sort((a,b)=>a-b).join(","))).size,8);
  for(const view of views) {assert.deepEqual(view.round.center,views[0].round.center);assert.equal(view.round.own.filter(s=>view.round.center.includes(s)).length,1);assert.ok(!JSON.stringify(view).includes("hands"));assert.ok(!JSON.stringify(view).includes("blockedUntil"));}
});
test("wrong click, cooldown, malformed and foreign actions never award points",t=>{
  let now=1000;t.mock.method(Date,"now",()=>now);
  let state=dobble.init(["a","b"]); const correct=match(state);
  const wrong=state.round.hands.a.find(s=>!state.round.center.includes(s))!;
  assert.equal(dobble.validateMove(state,"a",{...correct,symbolId:wrong}).ok,false);
  // The server records the wrong-guess cooldown via onInvalidMove (validateMove
  // itself is side-effect-free), so mirror that here before the next click.
  state=dobble.onInvalidMove!(state,"a",{...correct,symbolId:wrong});
  assert.equal(dobble.validateMove(state,"a",correct).ok,false); assert.equal(state.scores.a,0);
  now+=400;assert.equal(dobble.validateMove(state,"a",correct).ok,true);
  for(const move of [null,{}, {...correct,symbolId:NaN},{...correct,symbolId:57}, {...correct,roundId:"old"}]) assert.equal(dobble.validateMove(state,"a",move).ok,false);
  assert.equal(dobble.validateMove(state,"outsider",correct).ok,false);
});
test("atomic closure rejects double clicks and races, and schedules a different round",t=>{
  t.mock.method(Date,"now",()=>1000);
  let state=dobble.init(["a","b"]);const a=match(state),b=match(state,"b"),old=state.round;
  assert.equal(dobble.validateMove(state,"a",a).ok,true);state=dobble.applyMove(state,"a",a);
  assert.equal(state.scores.a,1);assert.equal(dobble.validateMove(state,"a",a).ok,false);assert.equal(dobble.validateMove(state,"b",b).ok,false);
  assert.equal(dobble.nextUpdateIn!(state),1000);state=dobble.advance!(state);
  assert.equal(state.round.number,2);assert.notEqual(state.round.id,old.id);assert.notDeepEqual(state.round.center,old.center);
  assert.equal(dobble.validateMove(state,"b",b).ok,false);
});
test("pause, reconnect and removal preserve scores and current cards",()=>{
  const state=dobble.init(["a","b","c"]);
  const paused=dobble.playersChanged!(state,["b"],["a","b","c"]);
  assert.equal(paused.paused,true);assert.equal(dobble.validateMove(paused,"b",match(paused,"b")).ok,false);
  const resumed=dobble.playersChanged!(paused,["a","b"],["a","b","c"]);
  assert.equal(resumed.paused,false);assert.deepEqual(resumed.round,state.round);
  const removed=dobble.playersChanged!(resumed,["b","c"],["b","c"]);
  assert.equal(removed.paused,false);assert.equal(dobble.validateMove(removed,"a",match(removed)).ok,false);
});
test("first to 10 wins, no round after game over, init resets scores for rematch",()=>{
  let state=dobble.init(["a","b"]);
  for(let i=0;i<10;i++){const move=match(state);assert.equal(dobble.validateMove(state,"a",move).ok,true);state=dobble.applyMove(state,"a",move);if(i<9)state=dobble.advance!(state);}
  assert.deepEqual(dobble.result(state),{over:true,winner:"a"});assert.equal(state.round.number,10);assert.equal(dobble.nextUpdateIn!(state),null);
  assert.equal(dobble.advance!(state),state);assert.deepEqual(dobble.init(["a","b"]).scores,{a:0,b:0});
});
test("Tic-Tac-Toe regression: invalid turn, win, draw and unchanged public shape",()=>{
  let state=ticTacToe.init(["a","b"]);
  assert.equal(ticTacToe.validateMove(state,"b",{cell:0}).ok,false);
  for(const [id,cell] of [["a",0],["b",3],["a",1],["b",4],["a",2]] as const) {const v=ticTacToe.validateMove(state,id,{cell});assert.equal(v.ok,true);if(v.ok)state=ticTacToe.applyMove(state,id,v.move);}
  assert.deepEqual(ticTacToe.result(state),{over:true,winner:"a"});assert.equal(state.turn,null);
  assert.deepEqual(Object.keys(state).sort(),["board","marks","turn"]);
  state=ticTacToe.init(["a","b"]);
  for(const cell of [0,1,2,4,3,5,7,6,8]) {const id=state.turn!;const v=ticTacToe.validateMove(state,id,{cell});assert.equal(v.ok,true);if(v.ok)state=ticTacToe.applyMove(state,id,v.move);}
  assert.deepEqual(ticTacToe.result(state),{over:true,winner:"draw"});
});
test("generic projection: explicit null never falls back to private server state",()=>{
  const manager=new RoomManager();const room=manager.createRoom();
  room.runtime={gameId:"test",game:{...ticTacToe,playerView:()=>null} as import("@app/shared").Game,state:{secret:"private"}};
  assert.equal(manager.gameView(room,"a"),null);manager.dispose();
});
