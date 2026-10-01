import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { createDeck, type JoinedMsg, type ServerMessage } from "@app/shared";
import { RoomManager, type Room } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames, games } from "../server/src/games/loader.ts";
import { advanceGame, publishGame } from "../server/src/gameRuntime.ts";
import type { BullshitState, BullshitView } from "../games/bullshit/types.ts";
import type { TicTacToeState } from "../games/tictactoe/types.ts";

class Peer {
  socket: WebSocket;
  history: ServerMessage[] = [];
  queue: ServerMessage[] = [];
  pending = new Set<() => void>();
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", raw => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.history.push(msg); this.queue.push(msg);
      for (const check of [...this.pending]) check();
    });
  }
  async open() { await new Promise<void>((resolve,reject) => { this.socket.once("open", resolve); this.socket.once("error",reject); }); return this; }
  send(msg: object) { this.socket.send(JSON.stringify(msg)); }
  wait(predicate: (m: ServerMessage) => boolean, timeoutMs=6000): Promise<ServerMessage> {
    return new Promise((resolve,reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if(i>=0){const msg=this.queue.splice(i,1)[0];clearTimeout(timer);this.pending.delete(check);resolve(msg);}
      };
      const timer=setTimeout(()=>{this.pending.delete(check);reject(Error("Timed out waiting for message"));},timeoutMs);
      this.pending.add(check);check();
    });
  }
  async close() {if(this.socket.readyState===WebSocket.CLOSED)return;await new Promise<void>(resolve=>{this.socket.once("close",resolve);this.socket.close();});}
}

function view(message: ServerMessage): BullshitView {
  assert.ok("state" in message); return message.state as BullshitView;
}
const isState = (phase: string, minVersion=0) => (m: ServerMessage) =>
  (m.type==="gameState"||m.type==="gameOver")&&(m.state as BullshitView).phase===phase&&(m.state as BullshitView).version>=minVersion;
function privatePayload(s: BullshitState, id: string, payload: BullshitView) {
  assert.equal(payload.selfId,id);assert.deepEqual(payload.myHand,s.hands[id]??[]);
  assert.ok(!("hands" in payload));assert.ok(!("pile" in payload));
  assert.ok(payload.players.every(p=>!("hand" in p)));
  if(payload.lastPlay)assert.ok(!("cards" in payload.lastPlay));
  const wire=JSON.stringify(payload);
  for(const other of s.players.filter(p=>p!==id))for(const card of s.hands[other]){
    if(!s.reveal?.cards.some(c=>c.id===card.id))assert.ok(!wire.includes(card.id),"Other hand leaked");
  }
  for(const card of s.pile)assert.ok(!wire.includes(card.id),"Hidden pile leaked");
}

test("real platform sockets: discovery, lobby, 8 players, private start/update/rejoin/end, challenge race, timers, rematch and tic-tac-toe", async () => {
  await loadGames(); assert.ok(games.has("bullshit"));assert.ok(games.has("tictactoe"));assert.ok(!games.has("_template"));
  const manager=new RoomManager();const http=createServer();const wss=new WebSocketServer({server:http,path:"/ws"});
  wss.on("connection",ws=>attachConnection(ws,manager));
  await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
  const url="ws://127.0.0.1:"+(http.address() as AddressInfo).port+"/ws";
  const clients:Peer[]=[];const rooms:Room[]=[];
  const connect=async()=>{const p=await new Peer(url).open();clients.push(p);return p;};
  try {
    const seated:Peer[]=[];const sessions:JoinedMsg[]=[];
    for(let i=0;i<8;i++){
      const p=await connect();seated.push(p);
      p.send(i===0?{type:"create",nickname:"P0"}:{type:"join",nickname:"P"+i,roomCode:sessions[0].roomCode});
      sessions.push(await p.wait(m=>m.type==="joined") as JoinedMsg);
    }
    const room=manager.getRoom(sessions[0].roomCode)!;rooms.push(room);
    assert.equal(room.players.size,8);
    seated[1].send({type:"startGame",gameId:"bullshit"});assert.equal((await seated[1].wait(m=>m.type==="error") as any).code,"not_host");
    seated[0].send({type:"startGame",gameId:"tictactoe"});assert.equal((await seated[0].wait(m=>m.type==="error") as any).code,"too_many");
    seated[0].send({type:"startGame",gameId:"bullshit"});
    let started=await Promise.all(seated.map(p=>p.wait(m=>m.type==="gameStarted")));
    let state=room.runtime!.state as BullshitState;
    assert.equal(started.reduce((n,m)=>n+view(m).myHand.length,0),52);
    for(let i=0;i<8;i++)privatePayload(state,sessions[i].playerId,view(started[i]));
    seated[0].send({type:"startGame",gameId:"bullshit"});assert.equal((await seated[0].wait(m=>m.type==="error") as any).code,"already");
    const turn=state.turnIndex;const actor=state.players[turn];const move={type:"playCards",cardIds:[state.hands[actor][0].id],playVersion:state.version,roundId:state.roundId};
    const waits=seated.map(p=>p.wait(isState("CHALLENGE_WINDOW",state.version+1)));
    seated[turn].send({type:"move",move});const updates=await Promise.all(waits);state=room.runtime!.state as BullshitState;
    for(let i=0;i<8;i++)privatePayload(state,sessions[i].playerId,view(updates[i]));
    const callers=[0,1,2,3,4,5,6,7].filter(i=>i!==turn).slice(0,2);
    const challenge={type:"challenge",playId:state.lastPlay!.id,roundId:state.roundId};
    const resolving=seated[turn].wait(isState("RESOLVING_CHALLENGE",state.version+1));
    for(const i of callers)seated[i].send({type:"move",move:challenge});
    await resolving;
    await Promise.any(callers.map(i=>seated[i].wait(m=>m.type==="error")));
    state=room.runtime!.state as BullshitState;assert.equal(state.pile.length,0);assert.equal(state.reveal!.cards.length,1);
    assert.equal(Object.values(state.hands).flat().length,52);
    const resumeIndex=callers[0];const oldHand=structuredClone(state.hands[sessions[resumeIndex].playerId]);
    await seated[resumeIndex].close();const resumed=await connect();seated[resumeIndex]=resumed;
    resumed.send({type:"rejoin",playerId:sessions[resumeIndex].playerId,roomCode:room.code});
    await resumed.wait(m=>m.type==="joined");
    const restored=view(await resumed.wait(m=>m.type==="gameStarted"));
    assert.deepEqual(restored.myHand,oldHand);assert.equal(restored.phase,"RESOLVING_CHALLENGE");
    privatePayload(state,sessions[resumeIndex].playerId,restored);
    const after=seated[turn].wait(isState("TURN",state.version+1));
    advanceGame(manager,room,state.deadline!);await after;
    state=room.runtime!.state as BullshitState;const nextIndex=state.turnIndex;
    seated[nextIndex].send({type:"move",move:{type:"playCards",cardIds:[state.hands[state.players[nextIndex]][0].id],playVersion:state.version,roundId:state.roundId}});
    const timerView=view(await seated[nextIndex].wait(isState("CHALLENGE_WINDOW",state.version+1)));
    // No further traffic: the actual server timer must advance on its own.
    await seated[nextIndex].wait(isState("TURN",timerView.version+1));
    seated[callers[1]].send({type:"move",move:{type:"challenge",playId:timerView.lastPlay!.id,roundId:timerView.roundId}});
    await seated[callers[1]].wait(m=>m.type==="error");
    const outsider=await connect();outsider.send({type:"getState",roomCode:room.code});
    assert.equal((await outsider.wait(m=>m.type==="error") as any).code,"unknown_type");
    outsider.send({type:"move",move:{type:"getState"}});assert.equal((await outsider.wait(m=>m.type==="error") as any).code,"no_room");

    // Exercise final snapshots and restart through the actual handlers.
    state=room.runtime!.state as BullshitState;
    const winnerIndex=state.turnIndex;const winner=state.players[winnerIndex];
    state.hands[winner]=[state.hands[winner][0]];
    const endMove={type:"playCards",cardIds:[state.hands[winner][0].id],playVersion:state.version,roundId:state.roundId};
    seated[winnerIndex].send({type:"move",move:endMove});
    const finalPlay=view(await seated[winnerIndex].wait(isState("CHALLENGE_WINDOW",state.version+1)));
    const ended=seated.map(p=>p.wait(m=>m.type==="gameOver"&&(m.state as BullshitView).roundId===state.roundId));
    advanceGame(manager,room,finalPlay.deadline!);
    const endings=await Promise.all(ended);
    assert.equal(room.runtime,null);assert.ok(room.lastGame);
    for(let i=0;i<8;i++)privatePayload(room.lastGame!.state as BullshitState,sessions[i].playerId,view(endings[i]));
    await seated[winnerIndex].close();const recovered=await connect();seated[winnerIndex]=recovered;
    recovered.send({type:"rejoin",playerId:sessions[winnerIndex].playerId,roomCode:room.code});
    await recovered.wait(m=>m.type==="joined");const finalResume=await recovered.wait(m=>m.type==="gameOver");assert.equal(view(finalResume).winner,winner);
    const hostIndex=sessions.findIndex(s=>s.playerId===room.hostId);
    seated[hostIndex].send({type:"startGame",gameId:"bullshit"});
    started=await Promise.all(seated.map(p=>p.wait(m=>m.type==="gameStarted"&&(m.state as BullshitView).roundId!==state.roundId)));
    assert.equal(started.reduce((n,m)=>n+view(m).myHand.length,0),52);assert.equal(room.lastGame,undefined);
    recovered.send({type:"move",move:endMove});await recovered.wait(m=>m.type==="error");

    // Two-player game and existing tic-tac-toe over the same infrastructure.
    const x=await connect(),o=await connect();x.send({type:"create",nickname:"X"});
    const sx=await x.wait(m=>m.type==="joined") as JoinedMsg;const second=manager.getRoom(sx.roomCode)!;rooms.push(second);
    o.send({type:"join",nickname:"O",roomCode:sx.roomCode});const so=await o.wait(m=>m.type==="joined") as JoinedMsg;
    x.send({type:"startGame",gameId:"tictactoe"});await x.wait(m=>m.type==="gameStarted");await o.wait(m=>m.type==="gameStarted");
    for(const [i,cell]of[0,3,1,4,2].entries()){
      const actor=i%2?o:x;actor.send({type:"move",move:{cell}});
      if(i<4)await actor.wait(m=>m.type==="gameState"&&(m.state as TicTacToeState).board.filter(Boolean).length===i+1);
    }
    const result=await x.wait(m=>m.type==="gameOver");assert.equal((result as any).winner,sx.playerId);assert.equal((result as any).gameId,"tictactoe");
    assert.equal(second.runtime,null);assert.ok(second.lastGame);
    x.send({type:"startGame",gameId:"bullshit"});const two=view(await x.wait(m=>m.type==="gameStarted"&&"phase" in (m.state as object)));
    const other=view(await o.wait(m=>m.type==="gameStarted"&&"phase" in (m.state as object)));
    assert.equal(two.myHand.length,26);assert.equal(other.myHand.length,26);
    privatePayload(second.runtime!.state as BullshitState,sx.playerId,two);
    privatePayload(second.runtime!.state as BullshitState,so.playerId,other);
  } finally {
    for(const c of clients)c.socket.terminate();
    await new Promise<void>(resolve=>wss.close(()=>resolve()));
    for(const r of rooms)manager.cancelPrune(r);
    await new Promise<void>(resolve=>http.close(()=>resolve()));
  }
});
