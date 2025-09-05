import { entities } from '@hedystia/better-auth-typeorm';

// Export the actual User entity class for TypeORM usage
export const UserEntity = entities[2]; // User is the third element in the entities array (0-indexed)
// Export the User type for type checking
export type User = Omit<InstanceType<typeof UserEntity>, 'image'> & {
  image?: string | null;
};
