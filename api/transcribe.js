const crypto = require('crypto');

function sha256Hmac(data, key) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function sha256Hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function callTencentASR(audioBase64, audioFormat) {
  const SecretId = process.env.TENCENT_SECRET_ID;
  const SecretKey = process.env.TENCENT_SECRET_KEY;
  if (!SecretId || !SecretKey) throw new Error('API 密钥未配置');

  const endpoint = 'asr.tencentcloudapi.com';
  const service = 'asr';
  const action = 'SentenceRecognition';
  const version = '2019-06-14';
  const region = 'ap-guangzhou';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const params = {
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: audioFormat || 'm4a',
    Data: audioBase64,
    DataLen: audioBuffer.length
  };
  const payload = JSON.stringify(params);

  // TC3-HMAC-SHA256 signing
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + endpoint + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST', '/', '',
    canonicalHeaders, signedHeaders,
    sha256Hash(payload)
  ].join('\n');

  const credentialScope = date + '/' + service + '/tc3_request';
  const stringToSign = [
    'TC3-HMAC-SHA256', String(timestamp),
    credentialScope, sha256Hash(canonicalRequest)
  ].join('\n');

  const kDate = sha256Hmac(date, 'TC3' + SecretKey);
  const kService = sha256Hmac(service, kDate);
  const kSigning = sha256Hmac('tc3_request', kService);
  const signature = sha256Hmac(stringToSign, kSigning);

  const authorization = 'TC3-HMAC-SHA256 Credential=' + SecretId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const resp = await fetch('https://' + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Host': endpoint,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
      'Authorization': authorization
    },
    body: payload
  });

  const result = await resp.json();
  if (result.Response.Error) {
    throw new Error(result.Response.Error.Message || '识别失败');
  }
  return result.Response.Result || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });

  try {
    const { audio, format } = req.body || {};
    if (!audio) return res.status(400).json({ error: '未收到音频数据' });

    const audioBuffer = Buffer.from(audio, 'base64');
    if (audioBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '音频过大（最大 5MB）' });
    }

    const text = await callTencentASR(audio, format || 'm4a');
    return res.status(200).json({ text });
  } catch (err) {
    console.error('Transcribe error:', err.message);
    return res.status(500).json({ error: err.message || '转写失败' });
  }
};
