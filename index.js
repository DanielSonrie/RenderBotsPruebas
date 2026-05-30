require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { createWorker } = require('tesseract.js');

const THEME_COLORS = { PRIMARY: '#00FFFF', SUCCESS: '#00FF00', WARNING: '#FFA500', ERROR: '#FF0000' };
const BOT_NAME = 'Verification Protocol Unit';
const BOT_ICON = 'https://i.imgur.com/gBwS2iG.png';

const verificationSettings = { roleId: null, channelId: null, tiktokUsername: null };
const userVerificationQueue = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL'],
});

let worker;
async function initializeOcr() {
  console.log('[BOOT] Initializing Tesseract.js OCR Engine...');
  worker = await createWorker({ logger: m => console.log(`[OCR] ${m.status}: ${m.progress}`) });
  await worker.loadLanguage('eng+spa');
  await worker.initialize('eng+spa');
  console.log('[BOOT] OCR Engine Online.');
}
initializeOcr();

const commands = [
  new SlashCommandBuilder()
    .setName('setverify')
    .setDescription('[ADMIN] Initialize or update the verification system protocols.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption(option => option.setName('role').setDescription('Target clearance level (role) to be granted.').setRequired(true))
    .addChannelOption(option => option.setName('channel').setDescription('Designated channel for manual review escalations.').setRequired(true))
    .addStringOption(option => option.setName('tiktok').setDescription('The target social network ID for verification.').setRequired(true)),
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Initiate the identity verification protocol.'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`[BOOT] System online. Logged in as ${client.user.tag}`);
  try {
    console.log('[BOOT] Refreshing application command matrix...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('[BOOT] Command matrix synchronized successfully.');
  } catch (error) {
    console.error('[CRITICAL] Failed to synchronize command matrix:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) handleCommand(interaction);
  else if (interaction.isButton()) handleButton(interaction);
});

async function handleCommand(interaction) {
  if (interaction.commandName === 'setverify') {
    await interaction.deferReply({ ephemeral: true });
    verificationSettings.roleId = interaction.options.getRole('role').id;
    verificationSettings.channelId = interaction.options.getChannel('channel').id;
    verificationSettings.tiktokUsername = interaction.options.getString('tiktok');
    const embed = new EmbedBuilder().setColor(THEME_COLORS.SUCCESS).setTitle('✅ System Protocols Updated').setDescription('New directives have been successfully loaded and are now active.').addFields({ name: 'Clearance Level (Role)', value: `<@&${verificationSettings.roleId}>`, inline: true },{ name: 'Escalation Channel', value: `<#${verificationSettings.channelId}>`, inline: true },{ name: 'Target Social ID', value: `\`${verificationSettings.tiktokUsername}\``, inline: true }).setTimestamp().setFooter({ text: BOT_NAME, iconURL: BOT_ICON });
    await interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'verify') {
    if (!verificationSettings.roleId) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('SYSTEM OFFLINE').setDescription('The verification protocol has not been initialized by an administrator. Cannot proceed.')], ephemeral: true });
    }
    try {
      await interaction.user.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.PRIMARY).setTitle('🔐 Verification Protocol Initiated').setDescription(`To continue, you must provide visual confirmation of your follow status for the user **${verificationSettings.tiktokUsername}** on TikTok.`).addFields({ name: 'Required Action', value: 'Please upload a single, clear screenshot showing you are following the target account. Ensure the button says "Following", "Friends", or similar.' }).setFooter({ text: 'This channel is secure and private.', iconURL: BOT_ICON })] });
      userVerificationQueue.set(interaction.user.id, { guildId: interaction.guild.id });
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.SUCCESS).setTitle('📡 Secure Channel Established').setDescription('A private, encrypted channel has been opened in your direct messages. Please check your DMs to proceed with verification.')], ephemeral: true });
    } catch (error) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('TRANSMISSION FAILED').setDescription('I was unable to establish a secure DM channel. Please ensure your privacy settings allow Direct Messages from server members and try again.')], ephemeral: true });
    }
  }
}
async function handleButton(interaction) {
 await interaction.deferReply({ ephemeral: true });
 const [action, targetUserId] = interaction.customId.split('_');
 const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
 if (!member) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('User Not Found').setDescription('The target user is no longer in this server.')] });
 const role = await interaction.guild.roles.fetch(verificationSettings.roleId).catch(() => null);
 if (!role) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('Configuration Error').setDescription('The designated role could not be found. An administrator must run `/setverify` again.')] });

 if (action === 'approve') {
     await member.roles.add(role);
     await member.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.SUCCESS).setTitle('✅ Access Granted by Administrator').setDescription(`Your manual verification was approved. You now have the **${role.name}** clearance level.`)] }).catch();
     await interaction.message.delete();
     await interaction.editReply({ content: `Action complete: Approved ${member.user.tag}.` });
 } else if (action === 'reject') {
     await member.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('❌ Access Denied by Administrator').setDescription('Your manual verification was rejected. Please ensure your next submission is a clear, valid screenshot and try again using `/verify`.')] }).catch();
     await interaction.message.delete();
     await interaction.editReply({ content: `Action complete: Rejected ${member.user.tag}.` });
 }
}


client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (!msg.guild) handleDirectMessage(msg);
  else if (verificationSettings.channelId && msg.channel.id === verificationSettings.channelId) {
     try {
         await msg.delete();
         const warningMsg = await msg.channel.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('ACCESS RESTRICTED').setDescription(`${msg.author}, this channel is a restricted area for system escalations only. To initiate verification, use the \`/verify\` command in any public channel.`)] });
         setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
     } catch (error) { console.error('Failed to moderate channel', error); }
  }
});

async function handleDirectMessage(msg) {
  if (!userVerificationQueue.has(msg.author.id)) return;
  if (msg.attachments.size === 0) return msg.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.PRIMARY).setTitle('Awaiting Data Transmission...').setDescription('Please upload your screenshot to proceed.')] });

  const attachment = msg.attachments.first();
  if (!attachment.contentType?.startsWith('image/')) return msg.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.WARNING).setTitle('Data Anomaly Detected').setDescription('The submitted file does not appear to be a valid image format.')] });

  await msg.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.PRIMARY).setTitle('🛰️ Analyzing Visual Data...').setDescription('Your submission is being processed by the OCR engine.')] });
  const { guildId } = userVerificationQueue.get(msg.author.id);
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(msg.author.id);

  try {
    const { data: { text } } = await worker.recognize(attachment.url);
    if (['following', 'siguiendo', 'friends', 'amigos'].some(kw => text.toLowerCase().includes(kw))) {
      const role = await guild.roles.fetch(verificationSettings.roleId);
      await member.roles.add(role);
      await msg.author.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.SUCCESS).setTitle('✅ Access Granted').setDescription(`Automated scan successful. You have been granted the **${role.name}** clearance level in **${guild.name}**.`)] });
    } else {
      await sendForManualReview(member, attachment, 'OCR engine could not find a valid follow keyword.');
      await msg.author.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.WARNING).setTitle('⚠️ Human Intervention Required').setDescription('My automated scan could not conclusively verify your status. Your case has been escalated to human administrators for manual review.')] });
    }
  } catch (ocrError) {
    console.error('[CRITICAL] OCR Engine failure:', ocrError);
    await sendForManualReview(member, attachment, 'A critical error occurred in the OCR engine.');
    await msg.author.send({ embeds: [new EmbedBuilder().setColor(THEME_COLORS.ERROR).setTitle('❌ Critical System Error').setDescription('The optical character recognition engine failed. Your case has been escalated to human administrators.')] });
  }
  userVerificationQueue.delete(msg.author.id);
}

async function sendForManualReview(member, attachment, reason) {
  if (!verificationSettings.channelId) return;
  const channel = await client.channels.fetch(verificationSettings.channelId).catch(() => null);
  if (!channel) return;
  const embed = new EmbedBuilder().setColor(THEME_COLORS.WARNING).setTitle('Escalation: Manual Verification').setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() }).setDescription(`**User:** ${member.user} (${member.id})`).addFields({ name: 'Reason', value: reason }).setImage(attachment.url).setTimestamp();
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_${member.id}`).setLabel('Grant Access').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`reject_${member.id}`).setLabel('Deny Access').setStyle(ButtonStyle.Danger));
  await channel.send({ embeds: [embed], components: [row] });
}

client.login(process.env.DISCORD_TOKEN);

const app = express();
app.get('/', (req, res) => res.send('Verification Protocol Unit: Status [ONLINE]'));
app.listen(process.env.PORT || 8080, () => console.log('[BOOT] Keep-alive service online.'));
  
