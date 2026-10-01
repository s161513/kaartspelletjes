import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeck, shuffle, deal } from "@app/shared";
import { createGame, validateMove, applyMove, tick, getViewForPlayer } from "../games/bullshit/logic.ts";
import { BULLSHIT_WINDOW_MS, REVEAL_MS, type BullshitState, type BullshitMove } from "../games/bullshit/types.ts";
import ticTacToe from "../games/tictactoe/logic.ts";

const ids = ["alice", "bob", "charlie"];
const setup = () => createGame(ids, () => 0);
const play = (s: BullshitState, cardIds = [s.hands[s.players[s.turnIndex]][0].id]): BullshitMove => ({
  type: "playCards", cardIds, playVersion: s.version, roundId: s.roundId,
});
const call = (s: BullshitState): BullshitMove => ({ type: "challenge", playId: s.lastPlay!.id, roundId: s.roundId });
function checkPrivacy(s: BullshitState, id: string) {
  const view = getViewForPlayer(s, id, 100);
  assert.deepEqual(view.myHand, s.hands[id]);
  assert.ok(!("hands" in view));
  assert.ok(!("pile" in view));
  assert.ok(view.players.every(p => !("hand" in p)));
  if (view.lastPlay) assert.ok(!("cards" in view.lastPlay));
  const wire = JSON.stringify(view);
  for (const player of s.players.filter(p => p !== id)) {
    for (const card of s.hands[player]) {
      if (!s.reveal?.cards.some(c => c.id === card.id)) assert.ok(!wire.includes(card.id));
    }
  }
  for (const card of s.pile) assert.ok(!wire.includes(card.id));
}

test("shared deck: 52 unique cards, four of each rank; shuffle preserves source and cards", () => {
  const deck = createDeck(); const original = structuredClone(deck);
  assert.equal(deck.length, 52); assert.equal(new Set(deck.map(c => c.id)).size, 52);
  assert.equal(deck.filter(c => c.rank === "A").length, 4);
  const shuffled = shuffle(deck, () => 0);
  assert.deepEqual(deck, original); assert.notDeepEqual(shuffled, deck);
  assert.deepEqual(new Set(shuffled.map(c => c.id)), new Set(deck.map(c => c.id)));
});

for (let count = 2; count <= 8; count++) test("one deck dealt fairly to " + count + " players", () => {
  const playerIds = Array.from({ length: count }, (_, i) => "p" + i);
  const s = createGame(playerIds, () => 0);
  const sizes = Object.values(s.hands).map(h => h.length);
  assert.equal(Object.values(s.hands).flat().length, 52);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  assert.deepEqual(Object.values(s.hands), deal(count, { decks: 1, rng: () => 0 }).hands);
});
test("player limits and unique seats", () => {
  assert.throws(() => createGame(["one"])); assert.throws(() => createGame(Array.from({length: 9}, (_,i) => String(i))));
  assert.throws(() => createGame(["one", "one"]));
});
test("random start uses RNG; Bullshit starts at ace independently of shared ace-high ranks", () => {
  assert.equal(createGame(ids, () => .99).turnIndex, 2);
  assert.equal(getViewForPlayer(setup(), "alice").claimedRank, "A");
});
test("valid multi-card selection, immutable action, and cards conserved", () => {
  const s = setup(); const before = structuredClone(s); const move = play(s, s.hands.alice.slice(0, 3).map(c => c.id));
  assert.equal(validateMove(s, "alice", move, 0).ok, true);
  const next = applyMove(s, "alice", move, 0);
  assert.deepEqual(s, before); assert.equal(next.pile.length, 3); assert.equal(next.hands.alice.length, s.hands.alice.length - 3);
  assert.equal(next.pile.length + Object.values(next.hands).flat().length, 52);
});
test("reject wrong turn, empty/duplicate/non-owned cards, malformed IDs and stale version", () => {
  const s = setup(); const valid = play(s);
  assert.equal(validateMove(s, "bob", valid, 0).ok, false);
  for (const cardIds of [[], [s.hands.alice[0].id, s.hands.alice[0].id], [s.hands.bob[0].id], ["fake"], [1]]) {
    assert.equal(validateMove(s, "alice", { ...valid, cardIds }, 0).ok, false);
  }
  assert.equal(validateMove(s, "alice", { ...valid, playVersion: -1 }, 0).ok, false);
  assert.equal(validateMove(s, "outsider", valid, 0).ok, false);
});
test("reject rank/pile/secret-state injection, unknown actions and old rounds", () => {
  const s = setup(); const valid = play(s);
  for (const extra of [{ rank: "7" }, { pile: [] }, { hands: {} }]) assert.equal(validateMove(s, "alice", {...valid, ...extra}, 0).ok, false);
  for (const raw of [null, [], {type: "getState", roundId:s.roundId}, {...valid,roundId:"old"}]) assert.equal(validateMove(s,"alice",raw,0).ok,false);
  const rematch = setup(); assert.equal(validateMove(rematch,"alice",valid,0).ok,false);
});
test("turn advances once after deadline; ranks wrap K to A", () => {
  const s = setup(); s.rankIndex = 12;
  const next = applyMove(s, "alice", play(s), 10);
  assert.equal(tick(next, 10 + BULLSHIT_WINDOW_MS - 1), next);
  const advanced = tick(next, 10 + BULLSHIT_WINDOW_MS);
  assert.equal(advanced.turnIndex, 1); assert.equal(advanced.rankIndex, 0);
  assert.equal(tick(advanced, 99999), advanced);
  assert.equal(validateMove(next, "alice", play(next), 11).ok, false);
});
for (const lied of [false,true]) test(lied ? "bluff: player picks up whole pile" : "truth: challenger picks up whole pile", () => {
  let s = setup();
  const older = s.hands.charlie.pop()!; s.pile.push(older);
  const card = s.hands.alice.find(c => lied ? c.rank !== "A" : c.rank === "A")!;
  s = applyMove(s, "alice", play(s, [card.id]), 0);
  s = applyMove(s, "bob", call(s), 1);
  assert.equal(s.reveal!.lied, lied); assert.equal(s.reveal!.loserId, lied ? "alice" : "bob");
  assert.equal(s.pile.length, 0); assert.ok(s.hands[lied ? "alice" : "bob"].some(c => c.id === older.id));
  assert.deepEqual(s.reveal!.cards.map(c => c.id), [card.id]); assert.equal(s.reveal!.pileCount, 2);
  assert.equal(Object.values(s.hands).flat().length, 52);
  for (const id of ids) checkPrivacy(s, id);
  const advanced = tick(s, 1 + REVEAL_MS); assert.equal(advanced.turnIndex, 1); assert.equal(advanced.rankIndex, 1);
});
test("mixed rank set is a lie, even if some cards match", () => {
  let s=setup();const cards=[s.hands.alice.find(c=>c.rank==="A")!,s.hands.alice.find(c=>c.rank!=="A")!];
  s=applyMove(s,"alice",play(s,cards.map(c=>c.id)),0);s=applyMove(s,"bob",call(s),1);assert.equal(s.reveal!.lied,true);
});
test("challenge phase, exact deadline, self-challenge and stale play ID", () => {
  let s=setup();assert.equal(validateMove(s,"bob",{type:"challenge",roundId:s.roundId,playId:"fake"},0).ok,false);
  s=applyMove(s,"alice",play(s),0);
  assert.equal(validateMove(s,"alice",call(s),1).ok,false);
  assert.equal(validateMove(s,"bob",{...call(s),playId:"old"},1).ok,false);
  assert.equal(validateMove(s,"bob",call(s),BULLSHIT_WINDOW_MS).ok,false);
  assert.equal(validateMove(s,"bob",call(s),BULLSHIT_WINDOW_MS-1).ok,true);
});
test("first challenge wins; second does not mutate state or pick up pile again", () => {
  let s=setup();s=applyMove(s,"alice",play(s),0);const move=call(s);
  s=applyMove(s,"bob",move,1);const before=structuredClone(s);
  assert.equal(validateMove(s,"charlie",move,1).ok,false);assert.throws(()=>applyMove(s,"charlie",move,1));assert.deepEqual(s,before);
});
for(const mode of ["no challenge","truth","lie"]) test("last card: "+mode,()=>{
  let s=setup();s.hands.alice=[createDeck().find(c=>c.rank===(mode==="lie"?"K":"A"))!];
  s=applyMove(s,"alice",play(s),0);assert.equal(s.winner,null);
  if(mode==="no challenge")s=tick(s,BULLSHIT_WINDOW_MS);
  else {s=applyMove(s,"bob",call(s),1);s=tick(s,1+REVEAL_MS);}
  assert.equal(s.winner,mode==="lie"?null:"alice");
  if(s.winner) assert.equal(validateMove(s,"bob",call(s),99999).ok,false);
});
test("private wire projections hide other hands and hidden pile in every phase",()=>{
  let s=setup();for(const id of ids)checkPrivacy(s,id);
  s=applyMove(s,"alice",play(s),0);for(const id of ids)checkPrivacy(s,id);
  s=tick(s,BULLSHIT_WINDOW_MS);for(const id of ids)checkPrivacy(s,id);
  const outsider=getViewForPlayer(s,"outside");assert.deepEqual(outsider.myHand,[]);
});
test("full round, correct winner, fresh rematch deck and new round ID",()=>{
  let s=setup();let now=0;
  while(s.phase!=="GAME_OVER"){const actor=s.players[s.turnIndex];s=applyMove(s,actor,play(s),now);now+=BULLSHIT_WINDOW_MS;s=tick(s,now);}
  assert.equal(s.hands[s.winner!].length,0);
  const fresh=createGame(s.players);assert.notEqual(fresh.roundId,s.roundId);assert.equal(fresh.phase,"TURN");assert.equal(Object.values(fresh.hands).flat().length,52);
});
test("existing tic-tac-toe: winner, draw, invalid turn and finished board",()=>{
  let s=ticTacToe.init(["x","o"]);
  assert.equal(ticTacToe.validateMove(s,"o",{cell:0}).ok,false);
  for(const [i,cell] of [0,3,1,4,2].entries())s=ticTacToe.applyMove(s,i%2?"o":"x",{cell});
  assert.deepEqual(ticTacToe.result(s),{over:true,winner:"x"});assert.equal(ticTacToe.validateMove(s,"o",{cell:8}).ok,false);
  s=ticTacToe.init(["x","o"]);for(const [i,cell]of[0,1,2,4,3,5,7,6,8].entries())s=ticTacToe.applyMove(s,i%2?"o":"x",{cell});
  assert.deepEqual(ticTacToe.result(s),{over:true,winner:"draw"});
});
