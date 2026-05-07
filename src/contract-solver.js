/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  const flags = ns.flags([
    ["tail", false],
    ["once", false],
    ["verbose", false],
  ]);
  if (flags.tail) {
    ns.ui.openTail();
  }

  const solved = new Set();
  const discovered = new Set();

  log(ns, `=== CONTRACT SOLVER INITIALIZED ===`);

  while (true) {
    const hosts = discoverServers(ns);
    let solvedThisPass = 0;

    for (const host of hosts) {
      const files = ns.ls(host, ".cct");
      for (const file of files) {
        const key = `${host}/${file}`;
        discovered.add(key);
        if (solved.has(key)) {
          continue;
        }

        const didSolve = solveContract(ns, host, file, flags.verbose);
        if (didSolve) {
          solved.add(key);
          solvedThisPass++;
        }
      }
    }

    const totalContracts = discovered.size;
    const solvedContracts = solved.size;
    const unsolvedContracts = totalContracts - solvedContracts;
    log(
      ns,
      `[Scan] Hosts: ${hosts.length} | Total: ${totalContracts} | Solved: ${solvedContracts} | Unsolved: ${unsolvedContracts} | Newly solved: ${solvedThisPass}`,
    );

    if (flags.once) {
      break;
    }

    await ns.sleep(10_000);
  }
}

function discoverServers(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    for (const neighbor of ns.scan(host)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return Array.from(seen);
}

function solveContract(ns, host, file, verbose = false) {
  let type;
  let data;
  let tries;

  try {
    type = normalizeType(ns.codingcontract.getContractType(file, host));
    data = ns.codingcontract.getData(file, host);
    tries = ns.codingcontract.getNumTriesRemaining(file, host);
  } catch (error) {
    log(ns, `[${host}] ${file}: unable to read contract (${error})`);
    return false;
  }

  const answer = solveByType(type, data);
  if (answer === null || answer === undefined) {
    log(ns, `[${host}] ${file}: unsupported contract type ${type}`);
    if (verbose) {
      log(ns, `[${host}] ${file}: data = ${formatValue(data)}`);
    }
    return false;
  }

  try {
    const reward = ns.codingcontract.attempt(answer, file, host, {
      returnReward: true,
    });
    if (reward !== false) {
      log(
        ns,
        `[${host}] ✓ ${type} -> ${reward || "Solved"} (${tries} tries left)`,
      );
      return true;
    }

    log(ns, `[${host}] ✗ ${type} failed (${tries} tries left)`);
    if (verbose) {
      log(ns, `[${host}] ${file}: data = ${formatValue(data)}`);
      log(ns, `[${host}] ${file}: answer = ${formatValue(answer)}`);
    }
  } catch (error) {
    log(ns, `[${host}] ${file}: attempt failed (${error})`);
  }

  return false;
}

function solveByType(type, data) {
  switch (type) {
    case "Find Largest Prime Factor":
      return findLargestPrimeFactor(data);
    case "Subarray with Maximum Sum":
      return subarrayWithMaximumSum(data);
    case "Total Ways to Sum":
      return totalWaysToSum(data);
    case "Total Ways to Sum II":
      return totalWaysToSumII(data);
    case "Spiralize Matrix":
      return spiralizeMatrix(data);
    case "Array Jumping Game":
      return arrayJumpingGame(data);
    case "Array Jumping Game II":
      return arrayJumpingGameII(data);
    case "Merge Overlapping Intervals":
      return mergeOverlappingIntervals(data);
    case "Generate IP Addresses":
      return generateIpAddresses(data);
    case "Algorithmic Stock Trader I":
      return algorithmicStockTraderI(data);
    case "Algorithmic Stock Trader II":
      return algorithmicStockTraderII(data);
    case "Algorithmic Stock Trader III":
      return algorithmicStockTraderIII(data);
    case "Algorithmic Stock Trader IV":
      return algorithmicStockTraderIV(data);
    case "Minimum Path Sum in a Triangle":
      return minimumPathSumInTriangle(data);
    case "Unique Paths in a Grid I":
      return uniquePathsInGridI(data);
    case "Unique Paths in a Grid II":
      return uniquePathsInGridII(data);
    case "Shortest Path in a Grid":
      return shortestPathInGrid(data);
    case "Sanitize Parentheses in Expression":
      return sanitizeParenthesesInExpression(data);
    case "Find All Valid Math Expressions":
      return findAllValidMathExpressions(data);
    case "HammingCodes: Integer to Encoded Binary":
      return hammingEncode(data);
    case "HammingCodes: Encoded Binary to Integer":
      return hammingDecode(data);
    case "Proper 2-Coloring of a Graph":
      return proper2ColoringOfAGraph(data);
    case "Compression I: RLE Compression":
      return rleCompression(data);
    case "Compression II: LZ Decompression":
      return lzDecompression(data);
    case "Compression III: LZ Compression":
      return lzCompression(data);
    case "Encryption I: Caesar Cipher":
      return caesarCipher(data);
    case "Encryption II: Vigenere Cipher":
      return vigenereCipher(data);
    case "Square Root":
      return bigIntSqrt(data);
    case "Total Primes in Range":
    case "Total Number of Primes":
      return totalPrimesInRange(data);
    case "Find Largest Rectangle in a Matrix":
      return largestRectangleInMatrix(data);
    default:
      return null;
  }
}

function normalizeType(type) {
  return String(type)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function log(ns, message) {
  ns.print(message);
}

function formatValue(value) {
  return JSON.stringify(
    value,
    (_, current) =>
      typeof current === "bigint" ? `${current.toString()}n` : current,
    2,
  );
}

function findLargestPrimeFactor(n) {
  let factor = 2;
  while (n > factor * factor) {
    while (n % factor === 0) {
      n = Math.floor(n / factor);
    }
    factor++;
  }
  return n === 1 ? factor - 1 : n;
}

function subarrayWithMaximumSum(arr) {
  let best = Number.NEGATIVE_INFINITY;
  let current = 0;
  for (const value of arr) {
    current = Math.max(value, current + value);
    best = Math.max(best, current);
  }
  return best;
}

function totalWaysToSum(n) {
  const ways = Array(n + 1).fill(0);
  ways[0] = 1;
  for (let addend = 1; addend < n; addend++) {
    for (let total = addend; total <= n; total++) {
      ways[total] += ways[total - addend];
    }
  }
  return ways[n];
}

function totalWaysToSumII(data) {
  const target = data[0];
  const numbers = data[1];
  const ways = Array(target + 1).fill(0);
  ways[0] = 1;
  for (const number of numbers) {
    for (let total = number; total <= target; total++) {
      ways[total] += ways[total - number];
    }
  }
  return ways[target];
}

function spiralizeMatrix(matrix) {
  const spiral = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;

  while (top <= bottom && left <= right) {
    for (let column = left; column <= right; column++) {
      spiral.push(matrix[top][column]);
    }
    top++;

    for (let row = top; row <= bottom; row++) {
      spiral.push(matrix[row][right]);
    }
    right--;

    if (top <= bottom) {
      for (let column = right; column >= left; column--) {
        spiral.push(matrix[bottom][column]);
      }
      bottom--;
    }

    if (left <= right) {
      for (let row = bottom; row >= top; row--) {
        spiral.push(matrix[row][left]);
      }
      left++;
    }
  }

  return spiral;
}

function arrayJumpingGame(arr) {
  const n = arr.length;
  let reach = 0;
  let i = 0;
  for (; i < n && i <= reach; i++) {
    reach = Math.max(reach, i + arr[i]);
  }
  return i === n ? 1 : 0;
}

function arrayJumpingGameII(arr) {
  const n = arr.length;
  let reach = 0;
  let jumps = 0;
  let lastJump = -1;

  while (reach < n - 1) {
    let jumpedFrom = -1;
    for (let i = reach; i > lastJump; i--) {
      if (i + arr[i] > reach) {
        reach = i + arr[i];
        jumpedFrom = i;
      }
    }
    if (jumpedFrom === -1) {
      return 0;
    }
    lastJump = jumpedFrom;
    jumps++;
  }

  return jumps;
}

function mergeOverlappingIntervals(intervals) {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  let [start, end] = sorted[0];

  for (const interval of sorted) {
    if (interval[0] <= end) {
      end = Math.max(end, interval[1]);
    } else {
      merged.push([start, end]);
      [start, end] = interval;
    }
  }

  merged.push([start, end]);
  return merged;
}

function generateIpAddresses(data) {
  const result = [];

  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) {
      for (let c = 1; c <= 3; c++) {
        for (let d = 1; d <= 3; d++) {
          if (a + b + c + d !== data.length) {
            continue;
          }

          const first = Number.parseInt(data.slice(0, a), 10);
          const second = Number.parseInt(data.slice(a, a + b), 10);
          const third = Number.parseInt(data.slice(a + b, a + b + c), 10);
          const fourth = Number.parseInt(data.slice(a + b + c), 10);

          if (first <= 255 && second <= 255 && third <= 255 && fourth <= 255) {
            const ip = [first, second, third, fourth].join(".");
            if (ip.length === data.length + 3) {
              result.push(ip);
            }
          }
        }
      }
    }
  }

  return result;
}

function algorithmicStockTraderI(prices) {
  let best = 0;
  let current = 0;
  for (let i = 1; i < prices.length; i++) {
    current = Math.max(0, current + prices[i] - prices[i - 1]);
    best = Math.max(best, current);
  }
  return best;
}

function algorithmicStockTraderII(prices) {
  let profit = 0;
  for (let i = 1; i < prices.length; i++) {
    profit += Math.max(prices[i] - prices[i - 1], 0);
  }
  return profit;
}

function algorithmicStockTraderIII(prices) {
  let hold1 = Number.NEGATIVE_INFINITY;
  let hold2 = Number.NEGATIVE_INFINITY;
  let release1 = 0;
  let release2 = 0;

  for (const price of prices) {
    release2 = Math.max(release2, hold2 + price);
    hold2 = Math.max(hold2, release1 - price);
    release1 = Math.max(release1, hold1 + price);
    hold1 = Math.max(hold1, -price);
  }

  return release2;
}

function algorithmicStockTraderIV(data) {
  const k = data[0];
  const prices = data[1];
  const length = prices.length;

  if (length < 2) {
    return 0;
  }

  if (k > length / 2) {
    let profit = 0;
    for (let i = 1; i < length; i++) {
      profit += Math.max(prices[i] - prices[i - 1], 0);
    }
    return profit;
  }

  const hold = Array(k + 1).fill(Number.NEGATIVE_INFINITY);
  const release = Array(k + 1).fill(0);

  for (const price of prices) {
    for (let transaction = k; transaction > 0; transaction--) {
      release[transaction] = Math.max(
        release[transaction],
        hold[transaction] + price,
      );
      hold[transaction] = Math.max(
        hold[transaction],
        release[transaction - 1] - price,
      );
    }
  }

  return release[k];
}

function minimumPathSumInTriangle(triangle) {
  const dp = triangle[triangle.length - 1].slice();
  for (let row = triangle.length - 2; row >= 0; row--) {
    for (let column = 0; column < triangle[row].length; column++) {
      dp[column] = Math.min(dp[column], dp[column + 1]) + triangle[row][column];
    }
  }
  return dp[0];
}

function uniquePathsInGridI(data) {
  const rows = data[0];
  const cols = data[1];
  const currentRow = Array(rows).fill(1);
  for (let row = 1; row < cols; row++) {
    for (let col = 1; col < rows; col++) {
      currentRow[col] += currentRow[col - 1];
    }
  }
  return currentRow[rows - 1];
}

function uniquePathsInGridII(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] === 1) {
        dp[row][col] = 0;
      } else if (row === 0 && col === 0) {
        dp[row][col] = 1;
      } else {
        dp[row][col] =
          (row > 0 ? dp[row - 1][col] : 0) + (col > 0 ? dp[row][col - 1] : 0);
      }
    }
  }

  return dp[rows - 1][cols - 1];
}

function shortestPathInGrid(grid) {
  const height = grid.length;
  const width = grid[0].length;
  const destinationY = height - 1;
  const destinationX = width - 1;

  const valid = (y, x) =>
    y >= 0 && y < height && x >= 0 && x < width && grid[y][x] === 0;
  if (!valid(0, 0) || !valid(destinationY, destinationX)) {
    return "";
  }

  const prev = Array.from({ length: height }, () => Array(width).fill(null));
  const queue = [[0, 0]];
  const directions = [
    [-1, 0, "U"],
    [1, 0, "D"],
    [0, -1, "L"],
    [0, 1, "R"],
  ];

  while (queue.length > 0) {
    const [y, x] = queue.shift();
    for (const [dy, dx, step] of directions) {
      const nextY = y + dy;
      const nextX = x + dx;
      if (
        valid(nextY, nextX) &&
        prev[nextY][nextX] === null &&
        !(nextY === 0 && nextX === 0)
      ) {
        prev[nextY][nextX] = [y, x, step];
        queue.push([nextY, nextX]);
      }
    }
  }

  if (prev[destinationY][destinationX] === null) {
    return "";
  }

  let path = "";
  let y = destinationY;
  let x = destinationX;
  while (y !== 0 || x !== 0) {
    const step = prev[y][x];
    if (!step) {
      return "";
    }
    path = step[2] + path;
    y = step[0];
    x = step[1];
  }

  return path;
}

function sanitizeParenthesesInExpression(input) {
  const isValid = (value) => {
    let balance = 0;
    for (const char of value) {
      if (char === "(") {
        balance++;
      } else if (char === ")") {
        balance--;
        if (balance < 0) {
          return false;
        }
      }
    }
    return balance === 0;
  };

  const visited = new Set([input]);
  let currentLevel = [input];

  while (currentLevel.length > 0) {
    const validResults = currentLevel.filter(isValid);
    if (validResults.length > 0) {
      return Array.from(new Set(validResults));
    }

    const nextLevel = [];
    for (const value of currentLevel) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== "(" && value[i] !== ")") {
          continue;
        }
        const candidate = value.slice(0, i) + value.slice(i + 1);
        if (!visited.has(candidate)) {
          visited.add(candidate);
          nextLevel.push(candidate);
        }
      }
    }
    currentLevel = nextLevel;
  }

  return [""];
}

function findAllValidMathExpressions(data) {
  const digits = data[0];
  const target = data[1];
  const results = [];

  function backtrack(path, index, evaluated, multiplied) {
    if (index === digits.length) {
      if (evaluated === target) {
        results.push(path);
      }
      return;
    }

    for (let end = index; end < digits.length; end++) {
      if (end !== index && digits[index] === "0") {
        break;
      }
      const current = Number.parseInt(digits.slice(index, end + 1), 10);

      if (index === 0) {
        backtrack(`${path}${current}`, end + 1, current, current);
      } else {
        backtrack(`${path}+${current}`, end + 1, evaluated + current, current);
        backtrack(`${path}-${current}`, end + 1, evaluated - current, -current);
        backtrack(
          `${path}*${current}`,
          end + 1,
          evaluated - multiplied + multiplied * current,
          multiplied * current,
        );
      }
    }
  }

  if (digits.length === 0) {
    return [];
  }

  backtrack("", 0, 0, 0);
  return results;
}

function hammingEncode(data) {
  const encoded = [0];
  const dataBits = data
    .toString(2)
    .split("")
    .reverse()
    .map((value) => Number.parseInt(value, 10));

  let k = dataBits.length;
  for (let i = 1; k > 0; i++) {
    if ((i & (i - 1)) !== 0) {
      encoded[i] = dataBits[--k];
    } else {
      encoded[i] = 0;
    }
  }

  let parityNumber = 0;
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i]) {
      parityNumber ^= i;
    }
  }

  const parityBits = parityNumber
    .toString(2)
    .split("")
    .reverse()
    .map((value) => Number.parseInt(value, 10));

  for (let i = 0; i < parityBits.length; i++) {
    encoded[2 ** i] = parityBits[i] ? 1 : 0;
  }

  parityNumber = 0;
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i]) {
      parityNumber++;
    }
  }

  encoded[0] = parityNumber % 2 === 0 ? 0 : 1;
  return encoded.join("");
}

function hammingDecode(data) {
  let errorIndex = 0;
  const bits = [];

  for (let i = 0; i < data.length; i++) {
    const bit = Number.parseInt(data[i], 10);
    bits[i] = bit;
    if (bit) {
      errorIndex ^= i;
    }
  }

  if (errorIndex) {
    bits[errorIndex] = bits[errorIndex] ? 0 : 1;
  }

  let decoded = "";
  for (let i = 1; i < bits.length; i++) {
    if ((i & (i - 1)) !== 0) {
      decoded += bits[i];
    }
  }

  return Number.parseInt(decoded, 2);
}

function proper2ColoringOfAGraph(data) {
  const nodeCount = data[0];
  const edges = data[1];
  const graph = Array.from({ length: nodeCount }, () => []);

  for (const [a, b] of edges) {
    graph[a].push(b);
    graph[b].push(a);
  }

  const colors = Array(nodeCount).fill(undefined);
  let conflict = false;

  const traverse = (node, color) => {
    if (conflict) {
      return;
    }
    if (colors[node] === color) {
      return;
    }
    if (colors[node] === (color ^ 1)) {
      conflict = true;
      return;
    }

    colors[node] = color;
    for (const neighbor of graph[node]) {
      traverse(neighbor, color ^ 1);
    }
  };

  while (!conflict && colors.some((value) => value === undefined)) {
    traverse(colors.indexOf(undefined), 0);
  }

  return conflict ? [] : colors;
}

function rleCompression(plain) {
  if (plain.length === 0) {
    return "";
  }

  let output = "";
  let count = 1;
  for (let i = 1; i < plain.length; i++) {
    if (count < 9 && plain[i] === plain[i - 1]) {
      count++;
      continue;
    }
    output += `${count}${plain[i - 1]}`;
    count = 1;
  }
  output += `${count}${plain[plain.length - 1]}`;
  return output;
}

function lzDecompression(compressed) {
  let plain = "";

  for (let i = 0; i < compressed.length; ) {
    const literalLength = compressed.charCodeAt(i) - 0x30;
    if (
      literalLength < 0 ||
      literalLength > 9 ||
      i + 1 + literalLength > compressed.length
    ) {
      return null;
    }

    plain += compressed.substring(i + 1, i + 1 + literalLength);
    i += 1 + literalLength;

    if (i >= compressed.length) {
      break;
    }

    const backrefLength = compressed.charCodeAt(i) - 0x30;
    if (backrefLength < 0 || backrefLength > 9) {
      return null;
    } else if (backrefLength === 0) {
      i++;
    } else {
      if (i + 1 >= compressed.length) {
        return null;
      }

      const backrefOffset = compressed.charCodeAt(i + 1) - 0x30;
      if (
        (backrefLength > 0 && (backrefOffset < 1 || backrefOffset > 9)) ||
        backrefOffset > plain.length
      ) {
        return null;
      }

      for (let j = 0; j < backrefLength; j++) {
        plain += plain[plain.length - backrefOffset];
      }

      i += 2;
    }
  }

  return plain;
}

function lzCompression(plain) {
  let currentState = Array.from({ length: 10 }, () => Array(10).fill(null));
  let nextState = Array.from({ length: 10 }, () => Array(10).fill(null));

  function setState(state, offset, length, value) {
    const current = state[offset][length];
    if (
      current === null ||
      value.length < current.length ||
      (value.length === current.length && Math.random() < 0.5)
    ) {
      state[offset][length] = value;
    }
  }

  currentState[0][1] = "";

  for (let index = 1; index < plain.length; index++) {
    for (const row of nextState) {
      row.fill(null);
    }

    const currentChar = plain[index];

    for (let length = 1; length <= 9; length++) {
      const value = currentState[0][length];
      if (value === null) {
        continue;
      }

      if (length < 9) {
        setState(nextState, 0, length + 1, value);
      } else {
        setState(
          nextState,
          0,
          1,
          value + "9" + plain.substring(index - 9, index) + "0",
        );
      }

      for (let offset = 1; offset <= Math.min(9, index); offset++) {
        if (plain[index - offset] === currentChar) {
          setState(
            nextState,
            offset,
            1,
            value + String(length) + plain.substring(index - length, index),
          );
        }
      }
    }

    for (let offset = 1; offset <= 9; offset++) {
      for (let length = 1; length <= 9; length++) {
        const value = currentState[offset][length];
        if (value === null) {
          continue;
        }

        if (plain[index - offset] === currentChar) {
          if (length < 9) {
            setState(nextState, offset, length + 1, value);
          } else {
            setState(nextState, offset, 1, value + "9" + String(offset) + "0");
          }
        }

        setState(nextState, 0, 1, value + String(length) + String(offset));

        for (let newOffset = 1; newOffset <= Math.min(9, index); newOffset++) {
          if (plain[index - newOffset] === currentChar) {
            setState(
              nextState,
              newOffset,
              1,
              value + String(length) + String(offset) + "0",
            );
          }
        }
      }
    }

    const temp = nextState;
    nextState = currentState;
    currentState = temp;
  }

  let result = null;

  for (let length = 1; length <= 9; length++) {
    let value = currentState[0][length];
    if (value === null) {
      continue;
    }
    value +=
      String(length) + plain.substring(plain.length - length, plain.length);
    if (
      result === null ||
      value.length < result.length ||
      (value.length === result.length && Math.random() < 0.5)
    ) {
      result = value;
    }
  }

  for (let offset = 1; offset <= 9; offset++) {
    for (let length = 1; length <= 9; length++) {
      let value = currentState[offset][length];
      if (value === null) {
        continue;
      }
      value += String(length) + String(offset);
      if (
        result === null ||
        value.length < result.length ||
        (value.length === result.length && Math.random() < 0.5)
      ) {
        result = value;
      }
    }
  }

  return result ?? "";
}

function caesarCipher(data) {
  const plaintext = data[0];
  const shift = data[1];
  return [...plaintext]
    .map((char) =>
      char === " "
        ? char
        : String.fromCharCode(
            ((char.charCodeAt(0) - 65 - shift + 26) % 26) + 65,
          ),
    )
    .join("");
}

function vigenereCipher(data) {
  const plaintext = data[0];
  const keyword = data[1];
  return [...plaintext]
    .map((char, index) => {
      if (char === " ") {
        return char;
      }
      return String.fromCharCode(
        ((char.charCodeAt(0) -
          2 * 65 +
          keyword.charCodeAt(index % keyword.length)) %
          26) +
          65,
      );
    })
    .join("");
}

function bigIntSqrt(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) {
    return "ERROR";
  }
  if (n < 2n) {
    return n;
  }

  let x0 = n;
  let x1 = (x0 + 1n) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + n / x1) >> 1n;
  }
  return x0;
}

function totalPrimesInRange(data) {
  let low = data[0];
  const high = data[1];
  if (low < 2) {
    low = 2;
  }
  if (high < low) {
    return 0;
  }

  const sieveLimit = Math.ceil(Math.sqrt(high));
  const base = Array(sieveLimit + 1).fill(false);
  const basePrimes = [];

  for (let i = 2; i * i <= sieveLimit; i++) {
    if (!base[i]) {
      for (let p = i * i; p <= sieveLimit; p += i) {
        base[p] = true;
      }
    }
  }

  for (let i = 2; i <= sieveLimit; i++) {
    if (!base[i]) {
      basePrimes.push(i);
    }
  }

  const range = Array(high - low + 1).fill(false);
  for (const prime of basePrimes) {
    const start = Math.max(prime * prime, Math.ceil(low / prime) * prime);
    for (let value = start; value <= high; value += prime) {
      range[value - low] = true;
    }
  }

  let count = 0;
  for (let i = 0; i < range.length; i++) {
    if (!range[i]) {
      count++;
    }
  }

  return count;
}

function largestRectangleInMatrix(grid) {
  const histograms = Array.from({ length: grid.length }, () =>
    Array(grid[0].length).fill(0),
  );

  for (let column = 0; column < grid[0].length; column++) {
    let count = 0;
    for (let row = 0; row < grid.length; row++) {
      if (grid[row][column] === 0) {
        count++;
      } else {
        count = 0;
      }
      histograms[row][column] = count;
    }
  }

  let maxArea = 0;
  let bestTop = 0;
  let bestLeft = 0;
  let bestBottom = 0;
  let bestRight = 0;

  for (let row = 0; row < histograms.length; row++) {
    const histogram = histograms[row];
    for (let column = 0; column < histogram.length; column++) {
      if (histogram[column] === 0) {
        continue;
      }

      let left = column;
      let right = column;
      while (histogram[left - 1] >= histogram[column]) {
        left--;
      }
      while (histogram[right + 1] >= histogram[column]) {
        right++;
      }

      const area = (right - left + 1) * histogram[column];
      if (area > maxArea) {
        maxArea = area;
        bestLeft = left;
        bestRight = right;
        bestTop = row - histogram[column] + 1;
        bestBottom = row;
      }
    }
  }

  return [
    [bestTop, bestLeft],
    [bestBottom, bestRight],
  ];
}
