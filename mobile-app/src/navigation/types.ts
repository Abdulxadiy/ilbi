export type BottomTabParamList = {
  Bosh: undefined;
  Tovar: undefined;
  Savdo: undefined;
  Qarz: undefined;
  Menyu: undefined; // Special tab: opens left drawer
};

export type RootDrawerParamList = {
  MainTabs: { screen?: keyof BottomTabParamList } | undefined;
  Documents: undefined;
  Inventory: undefined;
  Customers: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainDrawer: undefined;
  Checkout: undefined;
  ReceiptView: { sale?: any } | undefined;
  ShareSheet: { sale?: any } | undefined;
  PdfExport: { sale?: any } | undefined;
};
