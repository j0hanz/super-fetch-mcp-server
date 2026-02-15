param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [switch]$SkipBaseline,
  [string]$ReportPath = '.tmp/mcp-audit.report.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$AllowFailure
  )

  Write-Host ">> $FilePath $($Arguments -join ' ')"

  $supportsNativePref = $null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)
  $oldNativePref = $null
  if ($supportsNativePref) {
    $oldNativePref = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }
  $oldErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'

  $output = @()
  try {
    $output = & $FilePath @Arguments 2>&1
  }
  finally {
    $ErrorActionPreference = $oldErrorAction
    if ($supportsNativePref) {
      $PSNativeCommandUseErrorActionPreference = $oldNativePref
    }
  }
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }

  $outputLines = @(
    $output | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        $_.ToString()
      }
      else {
        [string]$_
      }
    }
  )

  if ($outputLines) {
    $outputLines | ForEach-Object { Write-Host $_ }
  }

  $result = [pscustomobject]@{
    filePath  = $FilePath
    arguments = $Arguments
    exitCode  = $exitCode
    output    = ($outputLines -join [Environment]::NewLine).Trim()
    pass      = ($exitCode -eq 0)
  }

  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')"
  }

  return $result
}

function Get-McpCliInvoker {
  $globalCli = Get-Command 'mcp-cli' -ErrorAction SilentlyContinue
  if ($globalCli) {
    return @{
      Name       = 'mcp-cli'
      FilePath   = 'mcp-cli'
      PrefixArgs = @()
    }
  }

  return @{
    Name       = 'npx -y @wong2/mcp-cli'
    FilePath   = 'npx'
    PrefixArgs = @('-y', '@wong2/mcp-cli')
  }
}

function Invoke-McpCliCommand {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Cli,
    [Parameter(Mandatory = $true)]
    [string[]]$CliArgs,
    [switch]$AllowFailure
  )

  $allArgs = @($Cli.PrefixArgs) + $CliArgs
  return Invoke-NativeCommand -FilePath $Cli.FilePath -Arguments $allArgs -AllowFailure:$AllowFailure
}

Write-Host "Repository root: $RepoRoot"
Push-Location $RepoRoot

try {
  $tmpDir = Join-Path $RepoRoot '.tmp'
  if (-not (Test-Path $tmpDir)) {
    New-Item -Path $tmpDir -ItemType Directory | Out-Null
  }

  $sdkScriptPath = Join-Path $tmpDir 'mcp-audit-sdk-check.mjs'
  $sdkReportPath = Join-Path $tmpDir 'mcp-audit.sdk-report.json'
  foreach ($artifact in @($sdkScriptPath, $sdkReportPath)) {
    if (Test-Path $artifact) {
      Remove-Item -Path $artifact -Force
    }
  }

  $configPath = Join-Path $tmpDir 'mcp-cli.config.json'
  $configJson = @{
    mcpServers = @{
      sut = @{
        command = 'node'
        args    = @('dist/index.js', '--stdio')
        cwd     = $RepoRoot
      }
    }
  } | ConvertTo-Json -Depth 5
  Write-Utf8NoBom -Path $configPath -Content $configJson

  $baselineResults = @()
  if (-not $SkipBaseline) {
    $baselineResults += Invoke-NativeCommand -FilePath 'npm' -Arguments @('-C', $RepoRoot, 'run', 'lint')
    $baselineResults += Invoke-NativeCommand -FilePath 'npm' -Arguments @('-C', $RepoRoot, 'run', 'type-check')
    $baselineResults += Invoke-NativeCommand -FilePath 'npm' -Arguments @('-C', $RepoRoot, 'run', 'build')
    $baselineResults += Invoke-NativeCommand -FilePath 'npm' -Arguments @('-C', $RepoRoot, 'run', 'test')
  }

  $mcpCli = Get-McpCliInvoker
  Write-Host "Using MCP CLI: $($mcpCli.Name)"

  $cliChecks = @()

  $cliSmoke = Invoke-McpCliCommand -Cli $mcpCli -CliArgs @('-c', $configPath, 'call-tool', 'sut:fetch-url', '--args', '{"url":"https://httpbin.org/html","maxInlineChars":120}') -AllowFailure
  $isKnownCliArgsCaveat = (
    $cliSmoke.exitCode -ne 0 -and
    $cliSmoke.output -match 'Invalid JSON in --args'
  )
  $cliChecks += [pscustomobject]@{
    name           = 'cli.call-tool.smoke'
    pass           = (
      ($cliSmoke.exitCode -eq 0 -and $cliSmoke.output -match '"structuredContent"') -or
      $isKnownCliArgsCaveat
    )
    classification = if ($isKnownCliArgsCaveat) { 'client_tooling' } else { 'server' }
    command        = "$($mcpCli.Name) -c $configPath call-tool sut:fetch-url --args {`"url`":`"https://httpbin.org/html`",`"maxInlineChars`":120}"
    observed       = $cliSmoke.output
  }

  $cliPrompt = Invoke-McpCliCommand -Cli $mcpCli -CliArgs @('-c', $configPath, 'get-prompt', 'sut:get-help') -AllowFailure
  $cliChecks += [pscustomobject]@{
    name           = 'cli.get-prompt.get-help'
    pass           = ($cliPrompt.exitCode -eq 0 -and $cliPrompt.output -match 'FETCH-URL INSTRUCTIONS')
    classification = 'server'
    command        = "$($mcpCli.Name) -c $configPath get-prompt sut:get-help"
    observed       = $cliPrompt.output
  }

  $cliReadResource = Invoke-McpCliCommand -Cli $mcpCli -CliArgs @('-c', $configPath, 'read-resource', 'sut:internal://instructions') -AllowFailure
  $isKnownCliUriCaveat = ($cliReadResource.exitCode -ne 0 -and $cliReadResource.output -match 'Invalid URL')
  $cliChecks += [pscustomobject]@{
    name           = 'cli.read-resource.instructions'
    pass           = ($cliReadResource.exitCode -eq 0 -or $isKnownCliUriCaveat)
    classification = if ($isKnownCliUriCaveat) { 'client_tooling' } else { 'server' }
    command        = "$($mcpCli.Name) -c $configPath read-resource sut:internal://instructions"
    observed       = $cliReadResource.output
  }

  $sdkScript = @'
/* eslint-env node */
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

const repoRoot = process.argv[2];
const reportPath = process.argv[3];

const checks = [];
const push = (name, pass, detail = {}) => checks.push({ name, pass, ...detail });

const client = new Client({ name: 'mcp-comprehensive-audit', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js', '--stdio'],
  cwd: repoRoot,
});

let smokeCacheUri = null;

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const resources = await client.listResources();
  const prompts = await client.listPrompts();

  const toolNames = (tools.tools ?? []).map((t) => t.name);
  const resourceUris = (resources.resources ?? []).map((r) => r.uri);
  const promptNames = (prompts.prompts ?? []).map((p) => p.name);

  push('discovery.tools.fetch-url', toolNames.includes('fetch-url'), { toolNames });
  push('discovery.resources.instructions', resourceUris.includes('internal://instructions'), { resourceUris });
  push('discovery.prompts.get-help', promptNames.includes('get-help'), { promptNames });

  const smoke = await client.callTool({
    name: 'fetch-url',
    arguments: { url: 'https://httpbin.org/html', maxInlineChars: 180 },
  });
  const s = smoke?.structuredContent ?? {};
  smokeCacheUri = typeof s.cacheResourceUri === 'string' ? s.cacheResourceUri : null;

  push('tool.smoke.success', !smoke?.isError && typeof s.markdown === 'string' && typeof s.url === 'string', {
    isError: Boolean(smoke?.isError),
    hasMarkdown: typeof s.markdown === 'string',
    hasUrl: typeof s.url === 'string',
    truncated: Boolean(s.truncated),
    cacheResourceUri: smokeCacheUri,
  });

  const optionRun = await client.callTool({
    name: 'fetch-url',
    arguments: {
      url: 'https://httpbin.org/html',
      skipNoiseRemoval: true,
      forceRefresh: true,
      maxInlineChars: 120,
    },
  });
  const o = optionRun?.structuredContent ?? {};
  push('tool.options.skipNoiseRemoval_forceRefresh_maxInlineChars', !optionRun?.isError && Boolean(o.truncated) && typeof o.markdown === 'string', {
    isError: Boolean(optionRun?.isError),
    truncated: Boolean(o.truncated),
    markdownLength: typeof o.markdown === 'string' ? o.markdown.length : null,
  });

  try {
    await client.callTool({
      name: 'fetch-url',
      arguments: { url: 'ftp://example.com' },
    });
    push('tool.negative.invalid-protocol', false, { observed: 'no error thrown' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push('tool.negative.invalid-protocol', /-32602|Invalid arguments/i.test(message), { observed: message });
  }

  const blockedHostRun = await client.callTool({
    name: 'fetch-url',
    arguments: { url: 'http://localhost' },
  });
  const bh = blockedHostRun?.structuredContent ?? {};
  push('tool.security.blocked-localhost', Boolean(blockedHostRun?.isError) && /Blocked host/i.test(String(bh.error ?? '')), {
    isError: Boolean(blockedHostRun?.isError),
    error: bh.error,
  });

  const rawTransformRun = await client.callTool({
    name: 'fetch-url',
    arguments: {
      url: 'https://github.com/octocat/Hello-World/blob/master/README',
      maxInlineChars: 200,
    },
  });
  const rt = rawTransformRun?.structuredContent ?? {};
  push('tool.raw-transform.github-blob', !rawTransformRun?.isError && typeof rt.resolvedUrl === 'string' && rt.resolvedUrl.includes('raw.githubusercontent.com'), {
    isError: Boolean(rawTransformRun?.isError),
    resolvedUrl: rt.resolvedUrl,
    finalUrl: rt.finalUrl,
  });

  const prompt = await client.getPrompt({ name: 'get-help' });
  const promptText = prompt?.messages?.[0]?.content?.type === 'text'
    ? prompt.messages[0].content.text
    : '';
  push('prompt.get-help', typeof promptText === 'string' && promptText.includes('FETCH-URL INSTRUCTIONS'), {
    description: prompt?.description,
    textPrefix: typeof promptText === 'string' ? promptText.slice(0, 60) : '',
  });

  const instructions = await client.readResource({ uri: 'internal://instructions' });
  const instructionsText = instructions?.contents?.[0]?.text ?? '';
  push('resource.instructions.read-sdk', typeof instructionsText === 'string' && instructionsText.includes('FETCH-URL INSTRUCTIONS'), {
    mimeType: instructions?.contents?.[0]?.mimeType,
    textPrefix: typeof instructionsText === 'string' ? instructionsText.slice(0, 60) : '',
  });

  if (smokeCacheUri) {
    const cached = await client.readResource({ uri: smokeCacheUri });
    const cachedText = cached?.contents?.[0]?.text ?? '';
    const inlineMarkdown = typeof s.markdown === 'string' ? s.markdown : '';
    push('resource.cache-uri.read-sdk', typeof cachedText === 'string' && cachedText.length >= inlineMarkdown.length, {
      cacheUri: smokeCacheUri,
      cachedLength: typeof cachedText === 'string' ? cachedText.length : null,
      inlineLength: inlineMarkdown.length,
    });
  } else {
    push('resource.cache-uri.read-sdk', false, { observed: 'no cacheResourceUri in smoke result' });
  }

  const taskStart = await client.request({
    method: 'tools/call',
    params: {
      name: 'fetch-url',
      arguments: { url: 'https://httpbin.org/html', maxInlineChars: 120 },
      task: { ttl: 60000 },
    },
  }, z.any());

  const taskId = taskStart?.task?.taskId;
  const taskGet = taskId
    ? await client.request({ method: 'tasks/get', params: { taskId } }, z.any())
    : null;
  const taskResult = taskId
    ? await client.request({ method: 'tasks/result', params: { taskId } }, z.any())
    : null;

  push('tasks.create-poll-result', typeof taskId === 'string' && typeof taskGet?.status === 'string' && taskResult && !taskResult.isError, {
    taskId,
    polledStatus: taskGet?.status,
    resultHasStructured: Boolean(taskResult?.structuredContent),
  });

  const cancelStart = await client.request({
    method: 'tools/call',
    params: {
      name: 'fetch-url',
      arguments: { url: 'https://httpbin.org/delay/5', maxInlineChars: 120 },
      task: { ttl: 60000 },
    },
  }, z.any());

  const cancelTaskId = cancelStart?.task?.taskId;
  let cancelOk = false;
  let cancelResultMessage = null;

  if (typeof cancelTaskId === 'string') {
    const cancelResponse = await client.request(
      { method: 'tasks/cancel', params: { taskId: cancelTaskId } },
      z.any()
    );
    const afterCancel = await client.request(
      { method: 'tasks/get', params: { taskId: cancelTaskId } },
      z.any()
    );

    try {
      await client.request(
        { method: 'tasks/result', params: { taskId: cancelTaskId } },
        z.any()
      );
      cancelResultMessage = 'tasks/result unexpectedly succeeded';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cancelResultMessage = message;
      cancelOk =
        cancelResponse?.status === 'cancelled' &&
        afterCancel?.status === 'cancelled' &&
        /cancel/i.test(message);
    }
  }

  push('tasks.cancel', cancelOk, {
    taskId: cancelTaskId,
    observed: cancelResultMessage,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  push('fatal.sdk-run', false, { observed: message });
} finally {
  await client.close().catch(() => undefined);
}

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass).length;
const report = { passed, failed, checks };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

if (failed > 0) {
  process.exitCode = 1;
}
'@
  Write-Utf8NoBom -Path $sdkScriptPath -Content $sdkScript

  $null = Invoke-NativeCommand -FilePath 'node' -Arguments @($sdkScriptPath, $RepoRoot, $sdkReportPath)
  $sdkReport = Get-Content -Path $sdkReportPath -Raw | ConvertFrom-Json

  $baselineFailed = @($baselineResults | Where-Object { -not $_.pass }).Count
  $sdkFailed = [int]$sdkReport.failed
  $cliFailed = @(
    $cliChecks | Where-Object {
      (-not $_.pass) -and $_.classification -eq 'server'
    }
  ).Count
  $cliCaveats = @(
    $cliChecks | Where-Object {
      $_.classification -eq 'client_tooling'
    }
  ).Count

  $report = [ordered]@{
    timestamp  = (Get-Date).ToString('o')
    repoRoot   = $RepoRoot
    mcpCli     = $mcpCli.Name
    configPath = $configPath
    baseline   = [ordered]@{
      skipped = [bool]$SkipBaseline
      steps   = $baselineResults
      failed  = $baselineFailed
    }
    cliChecks  = $cliChecks
    sdkChecks  = $sdkReport
    summary    = [ordered]@{
      baselineFailed          = $baselineFailed
      cliServerFailures       = $cliFailed
      cliClientToolingCaveats = $cliCaveats
      sdkFailures             = $sdkFailed
      hardFailures            = ($baselineFailed + $cliFailed + $sdkFailed)
    }
  }

  $resolvedReportPath = if ([System.IO.Path]::IsPathRooted($ReportPath)) {
    $ReportPath
  }
  else {
    Join-Path $RepoRoot $ReportPath
  }

  $reportDir = Split-Path -Path $resolvedReportPath -Parent
  if ($reportDir -and -not (Test-Path $reportDir)) {
    New-Item -Path $reportDir -ItemType Directory | Out-Null
  }

  $reportJson = $report | ConvertTo-Json -Depth 10
  Write-Utf8NoBom -Path $resolvedReportPath -Content $reportJson

  Write-Host ''
  Write-Host 'MCP Audit Summary'
  Write-Host "  Baseline failed: $baselineFailed"
  Write-Host "  CLI server failures: $cliFailed"
  Write-Host "  CLI client-tooling caveats: $cliCaveats"
  Write-Host "  SDK failures: $sdkFailed"
  Write-Host "  Report: $resolvedReportPath"

  if (($baselineFailed + $cliFailed + $sdkFailed) -gt 0) {
    exit 1
  }
}
finally {
  Pop-Location
}
