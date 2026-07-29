import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ChatRoom, Message } from './interfaces/chat.interface';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ShareCodeSnippetDto } from './dto/share-code-snippet.dto';
import { ChatRateLimiter } from './chat-rate-limit';

@Injectable()
export class ChatService {
  private rooms: ChatRoom[] = [];
  private messages: Message[] = [];
  private readonly rateLimiter = new ChatRateLimiter();

  createRoom(createRoomDto: CreateRoomDto): ChatRoom {
    const newRoom: ChatRoom = {
      id: Math.random().toString(36).substring(2, 9),
      ...createRoomDto,
      createdAt: new Date(),
    };
    this.rooms.push(newRoom);
    return newRoom;
  }

  findAllRooms(): ChatRoom[] {
    return this.rooms;
  }

  findRoomById(roomId: string): ChatRoom | undefined {
    return this.rooms.find((r) => r.id === roomId);
  }

  createMessage(createMessageDto: CreateMessageDto): Message {
    this.enforceRateLimit(createMessageDto.senderId);
    const newMessage: Message = {
      id: Math.random().toString(36).substring(2, 9),
      ...createMessageDto,
      createdAt: new Date(),
    };
    this.messages.push(newMessage);
    return newMessage;
  }

  shareCodeSnippet(shareCodeSnippetDto: ShareCodeSnippetDto): Message {
    this.enforceRateLimit(shareCodeSnippetDto.senderId);
    const newMessage: Message = {
      id: Math.random().toString(36).substring(2, 9),
      ...shareCodeSnippetDto,
      codeSnippet: {
        code: shareCodeSnippetDto.code,
        language: shareCodeSnippetDto.language,
        title: shareCodeSnippetDto.title,
      },
      createdAt: new Date(),
    };

    this.messages.push(newMessage);
    return newMessage;
  }

  findMessagesByRoom(roomId: string): Message[] {
    return this.messages.filter((m) => m.roomId === roomId);
  }

  /**
   * #373: Marks in-flight chat messages as incomplete when a streaming
   * disconnect is detected. This prevents partial AI responses from
   * persisting in the conversation history.
   *
   * Messages flagged as incomplete can be filtered out by the frontend
   * or cleaned up by the `cleanupIncompleteMessages` method.
   */
  markStreamingDisconnect(messageId: string): boolean {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    (msg as any).streamingComplete = false;
    (msg as any).streamingAbortedAt = new Date();
    return true;
  }

  /**
   * #373: Removes all incomplete messages from the in-memory store that
   * were abandoned due to streaming disconnects.
   */
  cleanupIncompleteMessages(): number {
    const before = this.messages.length;
    this.messages = this.messages.filter(
      (m) => (m as any).streamingComplete !== false,
    );
    return before - this.messages.length;
  }

  private enforceRateLimit(senderId: string): void {
    const { allowed, retryAfterSeconds } = this.rateLimiter.check(senderId);
    if (!allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Chat rate limit exceeded. Please slow down.',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
