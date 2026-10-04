import type { Pattern } from '../format/saveSlot';

/**
 * Bjorklund's algorithm, starting on an Event. Matches the manual's examples:
 * 3 in 8 is x..x..x. and 5 in 16 is x..x..x..x..x....
 */
export function euclid(length: number, events: number): boolean[] {
  if (length <= 0) return [];
  if (events <= 0) return new Array<boolean>(length).fill(false);
  if (events >= length) return new Array<boolean>(length).fill(true);

  let headCount = events;
  let head: boolean[] = [true];
  let tailCount = length - events;
  let tail: boolean[] = [false];

  while (tailCount > 1) {
    const joined = head.concat(tail);
    if (headCount > tailCount) {
      const rest = headCount - tailCount;
      headCount = tailCount;
      tail = head;
      tailCount = rest;
    } else {
      tailCount -= headCount;
    }
    head = joined;
  }

  const out: boolean[] = [];
  for (let i = 0; i < headCount; i++) out.push(...head);
  for (let i = 0; i < tailCount; i++) out.push(...tail);
  return out;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * One loop of a Pattern after Rotate and Burst, one entry per Pattern Clock
 * step. Rotate shifts Events later; Burst repeats each Event on the following
 * steps, wrapping around the loop.
 */
export function patternSteps(pattern: Pick<Pattern, 'length' | 'events' | 'rotate' | 'burst'>): boolean[] {
  const length = Math.max(1, pattern.length);
  const base = euclid(length, Math.min(pattern.events, length));
  const burst = Math.min(Math.max(1, pattern.burst), length);
  const steps = new Array<boolean>(length).fill(false);
  for (let s = 0; s < length; s++) {
    for (let j = 0; j < burst; j++) {
      if (base[mod(s - pattern.rotate - j, length)]) {
        steps[s] = true;
        break;
      }
    }
  }
  return steps;
}
