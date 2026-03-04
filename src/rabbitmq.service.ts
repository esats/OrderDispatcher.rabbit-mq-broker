import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import * as mssql from 'mssql';

export type ProfileMessage = {
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: number;
};

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RabbitmqService');
  private connection?: ChannelModel;
  private channel?: Channel;
  private pool?: mssql.ConnectionPool;

  async onModuleInit(): Promise<void> {
    const rabbitMqUrl =
      process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
    const queueName = process.env.QUEUE_NAME || 'profile.created.sync.queue';
    const prefetchRaw = process.env.PREFETCH;
    const parsedPrefetch = prefetchRaw ? Number.parseInt(prefetchRaw, 10) : 10;
    const prefetch = Number.isNaN(parsedPrefetch) ? 10 : parsedPrefetch;
    const sqlConnection =
      process.env.SQL_CONNECTION ||
      'Server=.;database=OrderDP.EngagementDB;User Id=sqladmin;Password=admin21;MultipleActiveResultSets=true;Connect Timeout=150;Encrypt=False;TrustServerCertificate=True';

    this.connection = await amqp.connect(rabbitMqUrl);
    this.channel = await this.connection.createChannel();

    const channel = this.channel;

    await channel.assertQueue(queueName, { durable: true });
    await channel.prefetch(prefetch);

    this.pool = await new mssql.ConnectionPool(sqlConnection).connect();

    this.logger.log('Connected to RabbitMQ...');
    this.logger.log('Waiting for messages on queue...');

    await channel.consume(
      queueName,
      async (message) => {
        if (!message) {
          return;
        }
        debugger
        const content = message.content.toString();
        try {
          const payload = JSON.parse(content) as Partial<ProfileMessage>;
          if (
            !payload ||
            typeof payload.userId !== 'string' ||
            typeof payload.username !== 'string' ||
            typeof payload.email !== 'string' ||
            typeof payload.firstName !== 'string' ||
            typeof payload.lastName !== 'string'
          ) {
            throw new Error('Invalid profile message payload.');
          }

          await this.insertProfile(payload as ProfileMessage);
          channel.ack(message);
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to process message: ${content}. Error: ${errorText}`,
          );
          channel.nack(message, false, false);
        }
      },
      { noAck: false },
    );
  }

  private async insertProfile(profile: ProfileMessage): Promise<void> {
    if (!this.pool) {
      throw new Error('SQL pool is not initialized.');
    }

    const query = `
INSERT INTO [dbo].[Profiles] (UserId, UserName, Email, FirstName, LastName, UserType, CreatedAtUtc, UpdatedAtUtc)
VALUES (@userId, @username, @email, @firstName, @lastName,  @userType, @createdAtUtc, @updatedAtUtc);
`;

    const now = new Date();
    await this.pool
      .request()
      .input('userId', mssql.NVarChar, profile.userId)
      .input('username', mssql.NVarChar, profile.username)
      .input('email', mssql.NVarChar, profile.email)
      .input('firstName', mssql.NVarChar, profile.firstName)
      .input('lastName', mssql.NVarChar, profile.lastName)
      .input('userType', mssql.Int, profile.userType)
      .input('createdAtUtc', mssql.DateTime2, now)
      .input('updatedAtUtc', mssql.DateTime2, now)
      .query(query);
  }

  getStatus(): { rabbitmq: boolean; sql: boolean } {
    return {
      rabbitmq: !!this.connection && !!this.channel,
      sql: !!this.pool?.connected,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to close channel: ${errorText}`);
      }
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to close connection: ${errorText}`);
      }
    }

    if (this.pool) {
      try {
        await this.pool.close();
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to close SQL pool: ${errorText}`);
      }
    }
  }
}
