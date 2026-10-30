module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const ghToken = (process.env.GITHUB_TOKEN || '').trim();
  if (!ghToken) {
    return res.status(500).json({ ok: false, error: 'Missing GITHUB_TOKEN' });
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
    if (req.method === 'POST') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { subject, message, filename, contentBase64 } = payload;

      const noteLines = [
        '### 📥 MENSAJE DIRECTO EN NUBE DE AUGUSTO (' + new Date().toISOString() + ')',
        '- **Asunto:** `' + (subject || 'Mensaje directo') + '`'
      ];

      if (filename && contentBase64) {
        const buf = Buffer.from(contentBase64, 'base64');
        const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const m = safeName.match(/^dia-(\d{3})\.m4a$/i);
        if (m) {
          const padDay = m[1];
          const existing = await ghGet('cien-dias-emperador', 'audio/dia-' + padDay + '.m4a');
          if (!existing) {
            const putAudio = await ghPut('cien-dias-emperador', 'audio/dia-' + padDay + '.m4a', buf, 'Subir audio/dia-' + padDay + '.m4a via Vigia Nube');
            noteLines.push('- **Audio publicado automáticamente en `cien-dias-emperador`:** `audio/dia-' + padDay + '.m4a` (SHA `' + putAudio.commit.sha + '`)');
          }
        } else {
          const ex = await ghGet('puente-jaime-augusto', 'buzon/' + safeName);
          await ghPut('puente-jaime-augusto', 'buzon/' + safeName, buf, 'Guardar buzon/' + safeName, ex ? ex.sha : undefined);
          noteLines.push('- **Archivo guardado en puente:** `buzon/' + safeName + '` (' + buf.length + ' bytes)');
        }
      }
      if (message) {
        noteLines.push('- **Texto:** ' + String(message).trim());
      }

      const paraObj = await ghGet('puente-jaime-augusto', 'PARA-AUGUSTO.md');
      const curText = paraObj ? Buffer.from(paraObj.content, 'base64').toString('utf8') : '# Canal Jaime <-> Augusto';
      const newText = curText.trimEnd() + '\n\n---\n\n' + noteLines.join('\n') + '\n';
      const updated = await ghPut('puente-jaime-augusto', 'PARA-AUGUSTO.md', Buffer.from(newText, 'utf8'), 'Actualizar PARA-AUGUSTO.md via Vigia Nube', paraObj ? paraObj.sha : undefined);

      return res.status(200).json({ ok: true, mode: 'post-recorded', sha: updated.commit.sha });
    }

    const paraObj = await ghGet('puente-jaime-augusto', 'PARA-AUGUSTO.md');
    const audioDir = await ghGet('cien-dias-emperador', 'audio');
    const days = Array.isArray(audioDir)
      ? audioDir.map(f => f.name).filter(n => /^dia-\d{3}\.m4a$/.test(n)).sort()
      : [];

    return res.status(200).json({
      ok: true,
      service: 'Vigia en la Nube 24/7 (Jaime <-> Augusto)',
      checkedAt: new Date().toISOString(),
      paraAugustoSha: paraObj ? paraObj.sha : null,
      paraAugustoUrl: 'https://raw.githubusercontent.com/DanielMH85/puente-jaime-augusto/main/PARA-AUGUSTO.md',
      cienDiasPublishedAudios: days
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
