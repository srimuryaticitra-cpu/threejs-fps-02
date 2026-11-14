// One palette for the whole game, so the map, the HUD and the bots read as one
// place: a dusk garden. Six colours only — dusk sky, stone, leaf, shell, ink and
// one warm amber for anything the player must notice (sites, the pod, the buy
// menu's accent). Nothing here copies another game's look.
export const PALETTE = {
  sky: 0x1d2b33, // dusk sky + fog + page background
  ground: 0x3d4a3a, // mossy garden floor
  stone: 0x8a8f96, // walls, crates, planters
  stoneDark: 0x565d66,
  leaf: 0x4f7a45, // hedges, garden beds
  shell: 0x6fae5e, // the Kura team: tortoise green
  hare: 0xd97b2f, // the Kelinci team: hare orange
  ink: 0xe9e6df, // HUD text
  muted: 0x9aa39a,
  amber: 0xf0a830, // sites, pod, accents
  pond: 0x3f7d8c, // Site B water
  red: 0xd95f4b, // damage, danger
};
