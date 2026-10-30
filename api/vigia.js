module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const ghToken = process.env.GITHUB_TOKEN;
  const inboxEmail = process.env.JAIME_INBOX_EMAIL;
  const inboxPassword = process.env.JAIME_INBOX_PASSWORD;

  if (!ghToken || !inboxEmail || !inboxPassword) {
    return res.status(500).json({ ok: false, error: 'Missing env vars' });
  }

  const ghHeaders = {
    Authorization: 'Bearer ' + ghToken,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Jaime-Cloud-Vigia-Vercel',
    'Content-Type': 'application/json'
  };

  async function ghGet(repo, path) {
    const r = await fetch('https://api.github.com/repos/DanielMH85/' + repo + '/contents/' + path, { headers: ghHeaders });
    if (!r.ok) return null;
    return await r.json();
  }

  async function ghPut(repo, path, buf, message, sha) {
    const body = { message, content: buf.toString('base64') };
    if (sha) body.sha = sha;
    const r = await fetch('https://api.github.com/repos/DanielMH85/' + repo + '/contents/' + path, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('GitHub PUT error ' + r.status + ' on ' + repo + '/' + path);
    return await r.json();
  }

  try {
    // 1. Load processed message IDs from repository state
    const stateObj = await ghGet('puente-jaime-augusto', 'procesados-nube.json');
    let processedList = [
      '6ae2f171eb869609ef435a8e',
      '6ae2f363e9ae2ad5545bf435',
      '6ae2f3cffabea26f2c6835ff',
      '6ae425e37bb538c4662221fe',
      '6ae43010e1f121423461081e',
      '6ae4313583ef6f34a52612ee',
      '6ae43bd36779a9b604d7081b'
    ];
    let stateSha = undefined;
    if (stateObj && stateObj.content) {
      stateSha = stateObj.sha;
      try {
        processedList = JSON.parse(Buffer.from(stateObj.content, 'base64').toString('utf8'));
      } catch {}
    }
    const processed = new Set(processedList);

    // 2. Authenticate with mail.tm
    const tokRes = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: inboxEmail, password: inboxPassword })
    });
    if (!tokRes.ok) {
      return res.status(502).json({ ok: false, error: 'mail.tm auth failed' });
    }
    const { token } = await tokRes.json();

    const listRes = await fetch('https://api.mail.tm/messages', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const listData = await listRes.json();
    const items = (listData['hydra:member'] || []).slice().reverse();

    const actions = [];

    for (const item of items) {
      if (processed.has(item.id)) continue;

      const msgRes = await fetch('https://api.mail.tm/messages/' + item.id, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const savedAtts = [];
      if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          const attRes = await fetch('https://api.mail.tm' + att.downloadUrl, {
            headers: { Authorization: 'Bearer ' + token }
          });
          const buf = Buffer.from(await attRes.arrayBuffer());
          const safeName = (att.filename || ('adjunto-' + att.id)).replace(/[^a-zA-Z0-9._-]/g, '_');
          savedAtts.push({ name: safeName, buf, size: buf.length });
        }
      }

      let noteLines = [];
      for (const att of savedAtts) {
        const m = att.name.match(/^dia-(\d{3})\.m4a$/i);
        if (m) {
          const padDay = m[1];
          const dayNum = parseInt(padDay, 10);
          const existing = await ghGet('cien-dias-emperador', 'audio/dia-' + padDay + '.m4a');
          if (!existing) {
            const putAudio = await ghPut(
              'cien-dias-emperador',
              'audio/dia-' + padDay + '.m4a',
              att.buf,
              'Subir automaticamente audio/dia-' + padDay + '.m4a via Vigia en la Nube'
            );
            noteLines.push(
              '### ✅ ENTREGA AUTOMÁTICA EN NUBE: Audio Día ' + dayNum + ' (`audio/dia-' + padDay + '.m4a`)',
              '- **Estado:** **PUBLICADO AUTOMÁTICAMENTE EN `DanielMH85/cien-dias-emperador` (`main`)**',
              '- **Commit (SHA):** `' + putAudio.commit.sha + '`',
              '- **Tamaño:** `' + att.size + '` bytes',
              '- **URL en vivo:** `https://cien-dias-emperador.vercel.app/audio/dia-' + padDay + '.m4a`'
            );
            actions.push({ type: 'cien-dias-audio', day: dayNum, sha: putAudio.commit.sha });
          } else {
            noteLines.push(
              '### ⚠️ AVISO EN NUBE: `audio/dia-' + padDay + '.m4a` ya existe en `cien-dias-emperador` (requiere confirmación de Daniel para sobrescribir).'
            );
          }
        } else {
          const exAtt = await ghGet('puente-jaime-augusto', 'buzon/' + att.name);
          await ghPut(
            'puente-jaime-augusto',
            'buzon/' + att.name,
            att.buf,
            'Guardar adjunto de Augusto en buzon/' + att.name,
            exAtt ? exAtt.sha : undefined
          );
          actions.push({ type: 'attachment-saved', name: 'buzon/' + att.name, size: att.size });
        }
      }

      if (noteLines.length === 0) {
        const attSummary = savedAtts.length
          ? savedAtts.map(a => '`buzon/' + a.name + '` (' + a.size + ' bytes)').join(', ')
          : 'Sin adjuntos';
        noteLines.push(
          '### 📥 ACUSE AUTOMÁTICO EN LA NUBE (24/7)',
          '- **ID de correo:** `' + msg.id + '`',
          '- **Fecha:** `' + new Date().toISOString() + '`',
          '- **Asunto:** `' + (msg.subject || '(sin asunto)') + '`',
          '- **Adjuntos recibidos en el repositorio:** ' + attSummary,
          '- **Mensaje:** ' + (msg.text || '').trim().slice(0, 500)
        );
        actions.push({ type: 'ack', id: msg.id, subject: msg.subject });
      }

      const paraObj = await ghGet('puente-jaime-augusto', 'PARA-AUGUSTO.md');
      const curText = paraObj ? Buffer.from(paraObj.content, 'base64').toString('utf8') : '# Canal Jaime <-> Augusto';
      const newText = curText.trimEnd() + '\n\n---\n\n' + noteLines.join('\n') + '\n';
      await ghPut(
        'puente-jaime-augusto',
        'PARA-AUGUSTO.md',
        Buffer.from(newText, 'utf8'),
        'Vigia en la nube: procesar correo ' + item.id,
        paraObj ? paraObj.sha : undefined
      );

      processed.add(item.id);
    }

    if (actions.length > 0 || !stateObj) {
      const latestState = await ghGet('puente-jaime-augusto', 'procesados-nube.json');
      await ghPut(
        'puente-jaime-augusto',
        'procesados-nube.json',
        Buffer.from(JSON.stringify([...processed], null, 2), 'utf8'),
        'Actualizar procesados-nube.json',
        latestState ? latestState.sha : undefined
      );
    }

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      inbox: inboxEmail,
      totalMessagesInInbox: items.length,
      newActionsProcessed: actions
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
