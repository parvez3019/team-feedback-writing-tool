#!/usr/bin/env node
/**
 * Local proxy for Team Feedback Tool.
 * Uses AWS Bedrock (Claude Sonnet) for generation. Credentials via env or default profile.
 *
 * Usage:
 *   export AWS_REGION=us-east-1   # optional, default us-east-1
 *   export AWS_ACCESS_KEY_ID=...  # or use default profile
 *   export AWS_SECRET_ACCESS_KEY=...
 *   node server.js
 * Then open http://localhost:3001/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';

function serveFile(filePath, res, contentType) {
  const full = path.join(__dirname, filePath);
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/generate') {
    try {
      const body = await parseBody(req);
      const rawMessages = body.messages || [];
      const maxTokens = body.max_tokens ?? 1000;

      // Convert to Bedrock format: content must be array of { type: 'text', text: string }
      const messages = rawMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: Array.isArray(m.content)
          ? m.content
          : [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }],
      }));

      const bedrockBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages,
      };

      const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({ region: AWS_REGION });
      const response = await client.send(
        new InvokeModelCommand({
          modelId: BEDROCK_MODEL_ID,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(bedrockBody),
        })
      );

      const data = JSON.parse(new TextDecoder().decode(response.body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      const message = err.message || 'Failed to fetch';
      const status = err.name === 'ValidationException' ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    serveFile('team-feedback-tool.html', res, 'text/html');
    return;
  }
  if (req.method === 'GET' && req.url === '/team-feedback-tool.html') {
    serveFile('team-feedback-tool.html', res, 'text/html');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Team Feedback Tool: http://localhost:${PORT}/`);
  console.log(`Bedrock model: ${BEDROCK_MODEL_ID} (region: ${AWS_REGION})`);
});
