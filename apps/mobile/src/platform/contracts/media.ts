export interface ChosenImage {
  name: string;
  bytes: Uint8Array;
  kind: "image" | "video";
}

export interface MediaAdapter {
  chooseEvidence(options?: {
    kind?: "image" | "video";
    capture?: boolean;
  }): Promise<ChosenImage>;
}
