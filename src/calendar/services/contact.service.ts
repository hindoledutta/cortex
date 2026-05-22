import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Contact } from '../../../prisma/generated/prisma/client/client';
import { ContactResolutionResult } from '../calendar.types';

/**
 * Manages the contacts directory for name-to-email resolution.
 * Contacts are scoped to workspaces for organizational isolation.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves person names to email addresses via case-insensitive lookup.
   * Returns separate lists of resolved and unresolved names.
   */
  async resolveNames(
    names: string[],
    workspaceId?: string,
  ): Promise<ContactResolutionResult> {
    const resolved: Array<{ name: string; email: string }> = [];
    const unresolved: string[] = [];

    for (const name of names) {
      const contact = await this.prisma.contact.findFirst({
        where: {
          name: { contains: name, mode: 'insensitive' },
          ...(workspaceId ? { workspaceId } : {}),
        },
      });

      if (contact) {
        resolved.push({ name: contact.name, email: contact.email });
      } else {
        unresolved.push(name);
      }
    }

    this.logger.log(
      `Name resolution: ${resolved.length} resolved, ${unresolved.length} unresolved`,
    );

    return { resolved, unresolved };
  }

  /**
   * Creates a new contact record in the directory.
   */
  async create(
    name: string,
    email: string,
    workspaceId?: string,
  ): Promise<Contact> {
    const contact = await this.prisma.contact.create({
      data: {
        name,
        email,
        workspaceId: workspaceId ?? null,
      },
    });

    this.logger.log(`Contact created: ${name} <${email}>`);
    return contact;
  }

  /**
   * Lists all contacts, optionally filtered by workspace.
   */
  async findAll(workspaceId?: string): Promise<Contact[]> {
    return this.prisma.contact.findMany({
      where: workspaceId ? { workspaceId } : {},
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Finds a contact by exact name match (case-insensitive) for deduplication.
   */
  async findByNameExact(
    name: string,
    workspaceId?: string,
  ): Promise<Contact | null> {
    return this.prisma.contact.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
  }
}
