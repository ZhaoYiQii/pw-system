export interface ChosenImage {
  name: string;
  bytes: Uint8Array;
}

export interface MediaAdapter {
  chooseImage(): Promise<ChosenImage>;
}
