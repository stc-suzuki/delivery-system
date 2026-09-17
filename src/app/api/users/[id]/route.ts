import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { email, password, name, role } = body;
    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(email !== undefined && { email }),
        ...(name !== undefined && { name }),
        ...(role !== undefined && { role }),
        ...(password && { password: await bcrypt.hash(password, 10) }),
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.[0];
      const message = target === 'name' ? 'この名前は既に登録されています' : 'このメールアドレスは既に登録されています';
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: 'ユーザーの更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await prisma.user.findUnique({ where: { id: params.id } });
    if (!user) {
      return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 });
    }

    const session = await getServerSession(authOptions);
    const currentUserId = (session?.user as { id?: string } | undefined)?.id;
    if (currentUserId && currentUserId === params.id) {
      return NextResponse.json({ error: 'ログイン中の自分自身のアカウントは削除できません' }, { status: 400 });
    }

    if (user.role === 'SYSTEM_ADMIN') {
      const otherAdminCount = await prisma.user.count({
        where: { role: 'SYSTEM_ADMIN', id: { not: params.id } },
      });
      if (otherAdminCount === 0) {
        return NextResponse.json(
          { error: '最後のシステム管理者は削除できません。先に別のシステム管理者を登録してください' },
          { status: 400 }
        );
      }
    }

    // Userは他モデルから外部キー参照されていない（PlanRoute.createdBy等は表示用の名前スナップショットのみ）ため、
    // Driver/Truckのような論理削除は不要で常に物理削除できる
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ユーザーの削除に失敗しました' }, { status: 500 });
  }
}
