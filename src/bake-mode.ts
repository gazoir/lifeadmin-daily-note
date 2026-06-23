/** When true, network-heavy dashboard bakes return placeholders during daily note creation. */
let deferNetworkBakes = false;

export function setDeferNetworkBakes(value: boolean): void {
  deferNetworkBakes = value;
}

export function shouldDeferNetworkBakes(): boolean {
  return deferNetworkBakes;
}
