import floresFomi from "./flores-fomi.js";
import fresasCrema from "./fresas-crema.js";
import gorras from "./gorras.js";

export const NEGOCIOS = {
  [floresFomi.id]: floresFomi,
  [fresasCrema.id]: fresasCrema,
  [gorras.id]: gorras,
};

export function elegirNegocio(id) {
  return NEGOCIOS[id] ?? null;
}
