// Proxy that captures full Claude Code requests & responses
//
// Usage:
//   node proxy-log.mjs                    # Forward to real Anthropic API
//   node proxy-log.mjs lmstudio           # Forward to LM Studio (localhost:1234)
//   node proxy-log.mjs http://custom:8080 # Forward to custom endpoint

import http from 'http'
import https from 'https'

const mode = process.argv[2] || 'anthropic'
const TARGETS = {
  anthropic: 'https://api.anthropic.com',
  lmstudio: 'http://localhost:1234',
}
const TARGET = TARGETS[mode] || mode
const isHTTPS = TARGET.startsWith('https')
const PORT = 3456
const LOG_FILE = 'claude-code-requests.json'

import { appendFileSync, writeFileSync } from 'fs'

// Start fresh log
writeFileSync(LOG_FILE, '[\n')
let first = true
let reqCount = 0

const server = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk

  reqCount++
  const num = reqCount

  // Log the full request
  const entry = {
    timestamp: new Date().toISOString(),
    request_num: num,
    method: req.method,
    url: req.url,
    headers: req.headers,
  }

  if (body) {
    try {
      entry.body = JSON.parse(body)
    } catch {
      entry.body = body
    }
  }

  // Console summary
  const model = entry.body?.model || '?'
  const systemChars = Array.isArray(entry.body?.system)
    ? entry.body.system.reduce((s, p) => s + (p.text?.length || 0), 0)
    : 0
  const toolCount = entry.body?.tools?.length || 0
  const msgCount = entry.body?.messages?.length || 0
  console.log(`[${num}] ${req.method} ${req.url} | model=${model} | system=${systemChars}ch | msgs=${msgCount} | tools=${toolCount}`)

  // Forward request
  const targetUrl = new URL(req.url, TARGET)
  const transport = isHTTPS ? https : http
  const fwdHeaders = { ...req.headers, host: targetUrl.host }

  // Collect response to log it too
  let responseBody = ''
  let responseChunks = []

  const proxyReq = transport.request(targetUrl, {
    method: req.method,
    headers: fwdHeaders,
  }, (proxyRes) => {
    // Stream response back to client
    res.writeHead(proxyRes.statusCode, proxyRes.headers)

    proxyRes.on('data', (chunk) => {
      res.write(chunk)
      responseChunks.push(chunk.toString())
    })

    proxyRes.on('end', () => {
      res.end()

      // Log response (first 5000 chars to keep file manageable for streaming)
      responseBody = responseChunks.join('')
      const isStream = responseBody.includes('event:') || responseBody.includes('data:')

      if (isStream) {
        // For streaming: extract just the text content from SSE events
        const texts = []
        for (const line of responseBody.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
          try {
            const evt = JSON.parse(line.slice(6))
            // Anthropic format
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              texts.push(evt.delta.text)
            }
            // OpenAI format
            if (evt.choices?.[0]?.delta?.content) {
              texts.push(evt.choices[0].delta.content)
            }
          } catch {}
        }
        entry.response_text = texts.join('')
        entry.response_type = 'stream'
      } else {
        // Non-streaming: log full response
        try {
          entry.response = JSON.parse(responseBody)
        } catch {
          entry.response_raw = responseBody.slice(0, 5000)
        }
        entry.response_type = 'json'
      }

      entry.response_status = proxyRes.statusCode

      // Write to log file
      const prefix = first ? '' : ',\n'
      first = false
      appendFileSync(LOG_FILE, prefix + JSON.stringify(entry, null, 2))
    })
  })

  proxyReq.on('error', (err) => {
    console.error(`[${num}] Proxy error:`, err.message)
    entry.error = err.message
    const prefix = first ? '' : ',\n'
    first = false
    appendFileSync(LOG_FILE, prefix + JSON.stringify(entry, null, 2))
    res.writeHead(502)
    res.end(JSON.stringify({ error: err.message }))
  })

  if (body) proxyReq.write(body)
  proxyReq.end()
})

server.listen(PORT, () => {
  console.log(`\nClaude Code Proxy`)
  console.log(`  Listening: http://localhost:${PORT}`)
  console.log(`  Forwarding: ${TARGET}`)
  console.log(`  Logging: ${LOG_FILE}`)
  console.log(`\nRun Claude Code with:`)
  console.log(`  ANTHROPIC_BASE_URL=http://localhost:${PORT} claude\n`)
})
