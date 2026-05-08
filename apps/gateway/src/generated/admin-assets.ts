export type EmbeddedAsset = {
  contentType: string;
  base64: string;
};

export const embeddedAdminAssets: Record<string, EmbeddedAsset> = {};
