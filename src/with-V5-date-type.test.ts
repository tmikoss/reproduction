import { Entity, EntityProperty, MikroORM, Platform, PrimaryKey, PrimaryKeyProp, Property, Type, ValidationError } from '@mikro-orm/postgresql';

// Latest from v5.x branch
class DateType extends Type<Date, string> {

  convertToDatabaseValue(value: Date | string | undefined | null, platform: Platform): string {
    if (value instanceof Date) {
      return value.toISOString().substr(0, 10);
    }

    if (!value || value.toString().match(/^\d{4}-\d{2}-\d{2}$/)) {
      return value as string;
    }

    throw ValidationError.invalidType(DateType, value, 'JS');
  }

  convertToJSValue(value: Date | string | null | undefined, platform: Platform): Date {
    if (!value || value instanceof Date) {
      return value as Date;
    }

    const date = new Date(value);

    if (date.toString() === 'Invalid Date') {
      throw ValidationError.invalidType(DateType, value, 'database');
    }

    return date;
  }

  compareAsType(): string {
    return 'string';
  }

  ensureComparable(): boolean {
    return false;
  }

  getColumnType(prop: EntityProperty, platform: Platform): string {
    return platform.getDateTypeDeclarationSQL(prop.length);
  }

  toJSON(value: Date, platform: Platform): Date | string {
    return this.convertToDatabaseValue(value, platform);
  }

}

@Entity()
class User {
  [PrimaryKeyProp]?: ['id', 'date'];

  @PrimaryKey()
  id!: number;

  @PrimaryKey({ type: DateType })
  date!: Date

  @Property()
  name: string;

  constructor(name: string, date: Date) {
    this.name = name;
    this.date = date;
  }
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    clientUrl: 'postgresql://postgres@localhost:5432/sample_database',
    entities: [User],
    debug: ['query', 'query-params'],
    allowGlobalContext: true, // only for testing
  });
  await orm.schema.refreshDatabase();
});

afterAll(async () => {
  await orm.close(true);
});

test('basic CRUD example', async () => {
  // It is essential that local time zone is set to UTC+ when running this.
  // My tests were UTC+3 (Europe/Riga)
  const date = new Date(2024, 5, 19)
  const id = 123

  orm.em.create(User, { id, date, name: 'Foo' });
  // Already here 2024-06-19 00:00:00 in UTC+3 zone gets transformed to 2024-06-18 21:00:00 UTC
  // insert into "user" ("id", "date", "name") values (123, '2024-06-18', 'Foo')
  await orm.em.flush();
  orm.em.clear();

  // select "u0".* from "user" as "u0" where "u0"."id" = 123 and "u0"."date" = '2024-06-18' limit 1
  const user = await orm.em.findOneOrFail(User, { id, date });
  expect(user.name).toBe('Foo');

  user.name = 'Bar';
  // The JS date got read as 2024-06-18 00:00:00, assumed to be in local zone, then converted to UTC
  // Also, it is trying to update `date` seemingly unnecessarily
  // update "user" set "date" = '2024-06-17', "name" = 'Bar' where "id" = 123 and "date" = '2024-06-17T21:00:00.000Z'
  await orm.em.flush();
  orm.em.clear();

  const secondCopy = await orm.em.findOneOrFail(User, { id, date });
  expect(secondCopy.name).toBe('Bar');
});
