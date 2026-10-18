#!/usr/bin/env node
import { main } from '../src/interfaces/cli/main.mjs';

process.exitCode = await main();
