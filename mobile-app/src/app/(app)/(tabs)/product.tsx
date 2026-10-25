import { useLocalSearchParams } from 'expo-router';
import { ProductScreen } from '../../../features/catalog/ProductScreen';
import { Notice, Page } from '../../../components/ui/Page';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>(), navigation = useAppNavigation();
  if (id !== undefined && id !== 'new' && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)) return <Page title="Mahsulot" onBack={navigation.goBack} insetBottom={false}><Notice error>Mahsulot raqami noto‘g‘ri.</Notice></Page>;
  return <ProductScreen id={id && id !== 'new' ? Number(id) : null} />;
}
