@echo off
setlocal
set "_PETERSON_CAROUSEL_NODE=node"
if defined PETERSON_CAROUSEL_NODE set "_PETERSON_CAROUSEL_NODE=%PETERSON_CAROUSEL_NODE%"
if exist "%~dp0harness-node.local.cmd" call "%~dp0harness-node.local.cmd"
"%_PETERSON_CAROUSEL_NODE%" "%~dp0harness-local.mjs" %*
exit /b %errorlevel%
