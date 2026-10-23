import type { ServerType } from '@mcsm/contracts';
import type { AddonInventory } from './addon-inventory.js';
import type { AddonUploadMetadata } from './addon-upload-metadata.js';
import { DomainError } from './domain-errors.js';

/** Unknown compatibility requires explicit acknowledgement; never report it as verified. */
export function assertAddonInstallAdmission(type: ServerType, metadata: AddonUploadMetadata,
  listing: Awaited<ReturnType<AddonInventory['read']>>, confirmUnknownCompatibility?: true) {
  if (type !== 'forge' && type !== 'neoforge') return;
  if (!confirmUnknownCompatibility) throw new DomainError(428, 'ADDON_COMPATIBILITY_CONFIRMATION_REQUIRED',
    '模组依赖和版本兼容性未验证；请明确确认未知兼容性及第三方代码风险', 'addon-compatibility-unverified');
  if (!('declaredMetadata' in metadata) || metadata.loader !== type || metadata.declaredMetadata.loader !== type) {
    throw new DomainError(409, 'ADDON_METADATA_INVALID', '暂存声明与当前加载器不匹配', 'addon-loader-mismatch');
  }
  const incoming = new Set(metadata.declaredMetadata.mods.map(mod => mod.id));
  if (listing.items.some(item => item.declaredMetadata?.mods.some(mod => incoming.has(mod.id)))) {
    throw new DomainError(409, 'ADDON_MOD_ID_CONFLICT', '启用或禁用目录中已存在相同模组标识；不会覆盖或替换', 'addon-mod-id-conflict');
  }
}
