'use strict';
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus, createAudioPlayer, createAudioResource, AudioPlayerStatus, EndBehaviorType, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
const prism = require('prism-media');
const OpenAI = require('openai');
const { Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');

const required = ['DISCORD_TOKEN','DISCORD_CLIENT_ID','OPENAI_API_KEY'];
for (const k of required) if (!process.env[k]) { console.error(`Missing ${k}. Configure Railway Variables or .env`); process.exit(1); }
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 1 });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const sessions = new Map();
const number = (key, fallback) => Number.isFinite(Number(process.env[key])) && process.env[key] !== undefined ? Number(process.env[key]) : fallback;
const config = {
  chat: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', transcribe: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  tts: process.env.OPENAI_TTS_MODEL || 'tts-1', voice: process.env.OPENAI_TTS_VOICE || 'alloy',
  persona: process.env.BOT_PERSONA || 'You are a helpful friendly Discord voice assistant. Keep replies short.',
  minSpeech: number('MIN_SPEECH_MS',650), maxSpeech: number('MAX_SPEECH_MS',18000), silence: number('SILENCE_MS',900),
  cooldown: number('USER_COOLDOWN_MS',2200), history: number('MAX_HISTORY_MESSAGES',12)
};
const commands = [
 new SlashCommandBuilder().setName('join').setDescription('Join your voice channel and start automatic AI conversation'),
 new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
 new SlashCommandBuilder().setName('status').setDescription('Show voice bot status'),
 new SlashCommandBuilder().setName('reset').setDescription('Clear this server AI conversation history')
].map(c => c.toJSON());

function wav(pcm, sampleRate=48000, channels=2) {
 const header=Buffer.alloc(44), bytes=pcm.length;
 header.write('RIFF',0);header.writeUInt32LE(36+bytes,4);header.write('WAVE',8);header.write('fmt ',12);
 header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(channels,22);
 header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*channels*2,28);
 header.writeUInt16LE(channels*2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes,40);
 return Buffer.concat([header,pcm]);
}
function endSession(guildId) {
 const s=sessions.get(guildId); if (!s) return;
 s.closed=true; s.active.clear();s.queue.length=0;s.player.stop(true);
 try{s.connection.destroy();}catch(_){}
 sessions.delete(guildId);
}
async function speak(session, text) {
 const result=await ai.audio.speech.create({model:config.tts,voice:config.voice,input:text.slice(0,1600),response_format:'mp3'});
 if(session.closed)return;
 const mp3=Buffer.from(await result.arrayBuffer());
 if(session.closed)return;
 const resource=createAudioResource(Readable.from([mp3]),{inputType:StreamType.Arbitrary});
 session.player.play(resource);
 await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{cleanup();reject(new Error('Audio playback timeout'));},90000);
   const done=()=>{cleanup();resolve();}; const error=e=>{cleanup();reject(e);};
   const cleanup=()=>{clearTimeout(timeout);session.player.off(AudioPlayerStatus.Idle,done);session.player.off('error',error);};
   session.player.once(AudioPlayerStatus.Idle,done);session.player.once('error',error);
   if(session.closed)done();
 });
}
async function processAudio(session, item) {
 if(session.closed)return;
 const {userId,pcm}=item;
 const audio=await ai.audio.transcriptions.create({file:await OpenAI.toFile(wav(pcm),'speech.wav',{type:'audio/wav'}),model:config.transcribe});
 const text=(audio.text||'').trim(); if(!text||session.closed)return;
 console.log(`[${session.guildId}] ${userId}: ${text.slice(0,150)}`);
 const history=session.history;
 const response=await ai.chat.completions.create({model:config.chat,messages:[{role:'system',content:config.persona},...history,{role:'user',content:`Discord member ${userId} said: ${text}`}],max_completion_tokens:180});
 const answer=(response.choices[0]?.message?.content||'').trim(); if(!answer||session.closed)return;
 history.push({role:'user',content:`Discord member ${userId}: ${text}`},{role:'assistant',content:answer});
 while(history.length>config.history)history.shift();
 console.log(`[${session.guildId}] AI: ${answer.slice(0,150)}`);
 await speak(session,answer);
}
async function worker(session) {
 if(session.working)return;session.working=true;
 try {while(!session.closed&&session.queue.length){const item=session.queue.shift();try{await processAudio(session,item);}catch(e){console.error('Voice processing failed:',e.message);session.player.stop(true);}}}
 finally{session.working=false;}
}
function listen(session,userId) {
 if(session.closed||session.active.has(userId)||userId===client.user.id)return;
 const now=Date.now();if(now-(session.lastSpoken.get(userId)||0)<config.cooldown)return;
 const member=session.guild.members.cache.get(userId);
 if(member?.user?.bot)return;
 const opus=session.connection.receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:config.silence}});
 const decoder=new prism.opus.Decoder({rate:48000,channels:2,frameSize:960});
 session.active.add(userId);
 const chunks=[];let bytes=0;let finished=false;
 const timer=setTimeout(()=>{opus.destroy();},config.maxSpeech+2500);
 const finish=()=>{
   if(finished)return;finished=true;clearTimeout(timer);session.active.delete(userId);
   const duration=bytes/(48000*2*2)*1000;
   if(session.closed||duration<config.minSpeech)return;
   session.lastSpoken.set(userId,Date.now());
   if(session.queue.length>=4)return;
   session.queue.push({userId,pcm:Buffer.concat(chunks)});void worker(session);
 };
 opus.on('error',e=>console.warn('Opus receive error:',e.message));
 decoder.on('data',chunk=>{if(bytes<config.maxSpeech*192){chunks.push(chunk);bytes+=chunk.length;}else opus.destroy();});
 decoder.on('error',e=>console.warn('Decode error:',e.message));
 decoder.once('end',finish);decoder.once('close',finish);
 opus.pipe(decoder);
}
async function join(interaction) {
 const member=await interaction.guild.members.fetch(interaction.user.id);
 const channel=member.voice.channel;
 if(!channel)return interaction.editReply('Pehle voice channel join karo, phir `/join` use karo.');
 const me=await interaction.guild.members.fetchMe();
 const permissions=channel.permissionsFor(me);
 if(!permissions?.has(PermissionFlagsBits.Connect)||!permissions?.has(PermissionFlagsBits.Speak))return interaction.editReply('Bot ko is VC mein Connect aur Speak permissions chahiye.');
 endSession(interaction.guildId);
 const connection=joinVoiceChannel({channelId:channel.id,guildId:interaction.guildId,adapterCreator:interaction.guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
 try{await entersState(connection,VoiceConnectionStatus.Ready,20000);}catch(e){connection.destroy();throw e;}
 const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});connection.subscribe(player);
 const session={guildId:interaction.guildId,guild:interaction.guild,channelId:channel.id,connection,player,history:[],active:new Set(),queue:[],working:false,closed:false,lastSpoken:new Map()};
 sessions.set(interaction.guildId,session);
 connection.receiver.speaking.on('start',userId=>listen(session,userId));
 connection.on(VoiceConnectionStatus.Disconnected,()=>{if(!session.closed)endSession(session.guildId);});
 player.on('error',e=>console.error('Player error:',e.message));
 return interaction.editReply(`🎙️ Joined **${channel.name}**! Automatic AI voice conversation enabled. Members ko batao ki bot unki voice OpenAI ko process karne ke liye bhejega. Use /leave to stop.`);
}
client.on('interactionCreate',async interaction=>{
 if(!interaction.isChatInputCommand()||!interaction.guildId)return;
 try{
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  if(interaction.commandName==='join')return await join(interaction);
  if(interaction.commandName==='leave'){const existed=sessions.has(interaction.guildId);endSession(interaction.guildId);return interaction.editReply(existed?'👋 Left voice channel.':'Bot is not connected.');}
  if(interaction.commandName==='reset'){const s=sessions.get(interaction.guildId);if(s)s.history.length=0;return interaction.editReply('🧹 Conversation history cleared.');}
  if(interaction.commandName==='status'){const s=sessions.get(interaction.guildId);return interaction.editReply(s?`🟢 Listening in <#${s.channelId}> | Queued: ${s.queue.length}`:'⚪ Not connected. Use /join.');}
 }catch(e){console.error('Command failed:',e);const msg=`❌ ${e.message||'Unexpected error'}`;if(interaction.deferred||interaction.replied)await interaction.editReply(msg).catch(()=>{});else await interaction.reply({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});}
});
client.once('clientReady',async()=>{
 console.log(`Logged in as ${client.user.tag}`);
 const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
 try{
  const guildId=process.env.GUILD_ID;
  if(guildId)await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,guildId),{body:commands});
  else await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),{body:commands});
  console.log('Slash commands registered.');
 }catch(e){console.error('Slash command registration failed:',e);}
});
process.on('SIGTERM',()=>{for(const id of sessions.keys())endSession(id);client.destroy();process.exit(0);});
process.on('SIGINT',()=>{for(const id of sessions.keys())endSession(id);client.destroy();process.exit(0);});
client.login(process.env.DISCORD_TOKEN).catch(e=>{console.error('Discord login failed:',e);process.exit(1);});
