import { useLocation } from 'react-router-dom'
import { FoodShoppingList } from '../components/FoodShoppingList'
import { SupplyShoppingList } from '../components/SupplyShoppingList'

/**
 * Two independent lists behind one nav entry: groceries and household supplies. The tab
 * lives in the path (not just state) so it survives a reload and can be linked to; the
 * nav matches on the /shopping prefix, so both paths keep it highlighted. Each list
 * renders the shared ShoppingFrame itself, since its aside and actions differ.
 */
export function Shopping() {
  const { pathname } = useLocation()
  return pathname.startsWith('/shopping/dom') ? <SupplyShoppingList /> : <FoodShoppingList />
}
