export type BrowserMode = "browser" | "preview" | "space-preview";

export type BrowserTabViewModel = {
  id: string;
  url: string;
  title: string;
  favicon?: string | null;
  loading?: boolean;
  pinned?: boolean;
};

export type BrowserProfileViewModel = {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
};
